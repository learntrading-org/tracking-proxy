import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  DateInput,
  Divider,
  Flex,
  Heading,
  Input,
  Select,
  Text,
  TextArea,
  hubspot,
} from "@hubspot/ui-extensions";

const API_BASE = "https://tracking-proxy-mocha.vercel.app";
const OPTIONS_URL = `${API_BASE}/api/hubspot/renewal-email/options`;
const EMAIL_URL = `${API_BASE}/api/hubspot/renewal-email`;

hubspot.extend(({ context, actions }) => (
  <RenewalEmailCard context={context} actions={actions} />
));

function toDateInput(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const numeric = Number(raw);
  const date =
    Number.isFinite(numeric) && /^\d+$/.test(raw)
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
      : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    date: date.getUTCDate(),
  };
}

function hubspotUserEmail(context) {
  const user = context?.user || {};
  if (user.email) return String(user.email).toLowerCase();
  if (Array.isArray(user.emails) && user.emails[0]) {
    const first = user.emails[0];
    return String(first.email || first).toLowerCase();
  }
  return "";
}

function parseJson(response) {
  return response.json().then((data) => ({ status: response.status, data }));
}

const RenewalEmailCard = ({ context, actions }) => {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [price, setPrice] = useState("");
  const [renewalDate, setRenewalDate] = useState(null);
  const [checkoutLink, setCheckoutLink] = useState("");
  const [templateId, setTemplateId] = useState("crypto");
  const [adminId, setAdminId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templates, setTemplates] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [ready, setReady] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewTick, setPreviewTick] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [statusType, setStatusType] = useState("info");

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === templateId) || templates[0],
    [templates, templateId]
  );
  const showCheckoutLink = Boolean(
    selectedTemplate?.extraFields?.includes("checkoutLink")
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const optionsRes = await hubspot.fetch(OPTIONS_URL);
        const optionsPayload = await parseJson(optionsRes);
        if (!optionsRes.ok) {
          throw new Error(optionsPayload.data?.error || "Failed to load Intercom teammates");
        }

        const loadedAdmins = optionsPayload.data.admins || [];
        const loadedTemplates = optionsPayload.data.templates || [];
        const userEmail = hubspotUserEmail(context);
        const matchingAdmin = loadedAdmins.find(
          (admin) => String(admin.email || "").toLowerCase() === userEmail
        );

        if (cancelled) return;
        setAdmins(loadedAdmins);
        setTemplates(loadedTemplates);
        setAdminId(
          matchingAdmin?.id || optionsPayload.data.defaultAdminId || loadedAdmins[0]?.id || ""
        );
        if (loadedTemplates[0]?.id) setTemplateId(loadedTemplates[0].id);
      } catch (err) {
        if (!cancelled) {
          setStatusType("error");
          setStatusMessage(err.message || "Failed to load renewal email options");
        }
      }

      if (actions?.fetchCrmObjectProperties) {
        try {
          const properties = await actions.fetchCrmObjectProperties([
            "email",
            "firstname",
            "price",
            "renewal_date",
          ]);
          if (cancelled) return;
          if (properties.email) setEmail(String(properties.email));
          if (properties.firstname) setFirstName(String(properties.firstname));
          if (properties.price) setPrice(String(properties.price));
          const parsedDate = toDateInput(properties.renewal_date);
          if (parsedDate) setRenewalDate(parsedDate);
        } catch (err) {
          console.warn("Could not fetch contact properties:", err);
        }
      }

      if (!cancelled) setReady(true);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [actions, context]);

  useEffect(() => {
    if (!ready || !email) return undefined;

    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewing(true);
      hubspot
        .fetch(EMAIL_URL, {
          method: "POST",
          body: {
            mode: "preview",
            email,
            firstName,
            price,
            renewalDate,
            checkoutLink,
            templateId,
          },
        })
        .then(parseJson)
        .then(({ status, data }) => {
          if (cancelled) return;
          if (status >= 200 && status < 300) {
            setSubject(data.subject || "");
            setBody(data.body || "");
          } else {
            throw new Error(data.error || "Failed to preview email");
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setStatusType("error");
          setStatusMessage(err.message || "Failed to preview email");
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, email, firstName, price, renewalDate, checkoutLink, templateId, previewTick]);

  const submit = (mode) => {
    if (!email) {
      setStatusType("error");
      setStatusMessage("Contact email is required.");
      return;
    }
    if (!price) {
      setStatusType("error");
      setStatusMessage("Price is required.");
      return;
    }
    if (!adminId) {
      setStatusType("error");
      setStatusMessage("Choose a teammate to send on behalf of.");
      return;
    }
    if (!body.trim()) {
      setStatusType("error");
      setStatusMessage("Email body is empty.");
      return;
    }

    setSubmitting(true);
    setStatusMessage(null);

    hubspot
      .fetch(EMAIL_URL, {
        method: "POST",
        body: {
          source: "card",
          mode,
          contactId: context?.crm?.objectId,
          email,
          firstName,
          price,
          renewalDate,
          checkoutLink,
          templateId,
          adminId,
          subject,
          body,
        },
      })
      .then(parseJson)
      .then(({ status, data }) => {
        if (status >= 200 && status < 300 && data.status === "SUCCESS") {
          setStatusType("success");
          setStatusMessage(data.message || (mode === "draft" ? "Draft saved in Intercom." : "Email sent."));
          if (actions?.refreshObjectProperties) {
            actions.refreshObjectProperties();
          }
        } else {
          throw new Error(data.error || data.message || "Request failed");
        }
      })
      .catch((err) => {
        setStatusType("error");
        setStatusMessage(err.message || "Failed to process renewal email");
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const adminOptions = admins.map((admin) => ({
    label: admin.away ? `${admin.name} (away)` : `${admin.name} (${admin.email})`,
    value: admin.id,
  }));

  const templateOptions = templates.map((template) => ({
    label: template.label,
    value: template.id,
  }));

  const busy = submitting || previewing;

  return (
    <Flex direction="column" gap="medium">
      <Box>
        <Heading>Renewal Email</Heading>
        <Text>
          Sends an Intercom email conversation. The teammate below authors the reply; customers receive it from hello@bullmania.com.
        </Text>
      </Box>

      <Divider />

      <Box>
        <Text>Template</Text>
        <Select
          name="templateId"
          value={templateId}
          onChange={setTemplateId}
          options={templateOptions.length ? templateOptions : [{ label: "Crypto renewal", value: "crypto" }]}
        />
        {selectedTemplate?.description ? <Text>{selectedTemplate.description}</Text> : null}
      </Box>

      <Box>
        <Text>Send on behalf of</Text>
        <Select
          name="adminId"
          value={adminId}
          onChange={setAdminId}
          options={adminOptions.length ? adminOptions : [{ label: "Loading teammates...", value: "" }]}
        />
      </Box>

      <Box>
        <Text>Email</Text>
        <Input name="email" value={email} onChange={setEmail} />
      </Box>

      <Box>
        <Text>First name</Text>
        <Input name="firstName" value={firstName} onChange={setFirstName} />
      </Box>

      <Box>
        <Text>Price</Text>
        <Input name="price" value={price} onChange={setPrice} />
      </Box>

      <Box>
        <Text>Renewal date</Text>
        <DateInput name="renewalDate" value={renewalDate} onChange={setRenewalDate} />
      </Box>

      {showCheckoutLink ? (
        <Box>
          <Text>Card checkout link (optional)</Text>
          <Input name="checkoutLink" value={checkoutLink} onChange={setCheckoutLink} />
        </Box>
      ) : null}

      <Divider />

      <Box>
        <Text>Subject</Text>
        <Input name="subject" value={subject} onChange={setSubject} />
      </Box>

      <Box>
        <Text>Email body</Text>
        <TextArea
          name="body"
          value={body}
          rows={12}
          onInput={setBody}
          onChange={setBody}
        />
        <Text>Generated from the template. Edit before sending if you need a small tweak.</Text>
      </Box>

      {statusMessage ? (
        <Alert
          title={statusType === "success" ? "Success" : statusType === "error" ? "Error" : "Notice"}
          variant={statusType}
        >
          {statusMessage}
        </Alert>
      ) : null}

      <Flex direction="row" gap="small">
        <Button onClick={() => setPreviewTick((tick) => tick + 1)} disabled={busy}>
          Reset to template
        </Button>
        <Button onClick={() => submit("draft")} disabled={busy || !email}>
          {submitting ? "Working..." : "Save draft"}
        </Button>
        <Button variant="primary" onClick={() => submit("send")} disabled={busy || !email}>
          {submitting ? "Working..." : "Send email"}
        </Button>
      </Flex>
    </Flex>
  );
};

export default RenewalEmailCard;
