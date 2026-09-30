import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  DescriptionList,
  DescriptionListItem,
  Divider,
  EmptyState,
  ErrorState,
  Flex,
  Heading,
  LoadingSpinner,
  Select,
  StatusTag,
  Tag,
  Text,
  hubspot,
} from "@hubspot/ui-extensions";

const API_URL = "https://tracking-proxy-mocha.vercel.app/api/hubspot/contact-profile";
const COURSE_ID = "187845";

hubspot.extend(({ context, actions }) => (
  <ContactProfileCard context={context} actions={actions} />
));

function parseJson(response) {
  return response.json().then((data) => ({ status: response.status, data }));
}

const ContactProfileCard = ({ actions }) => {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [profile, setProfile] = useState(null);
  const [tagToAdd, setTagToAdd] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusType, setStatusType] = useState("info");

  const callApi = useCallback(async (payload) => {
    const response = await hubspot.fetch(API_URL, { method: "POST", body: payload });
    const parsed = await parseJson(response);
    if (parsed.status < 200 || parsed.status >= 300 || parsed.data.error) {
      throw new Error(parsed.data.error || "Request failed");
    }
    return parsed.data;
  }, []);

  const refresh = useCallback(
    async (currentEmail) => {
      const data = await callApi({ action: "load", email: currentEmail });
      setProfile(data);
      return data;
    },
    [callApi]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let contactEmail = "";
        let contactName = "";
        if (actions?.fetchCrmObjectProperties) {
          const properties = await actions.fetchCrmObjectProperties([
            "email",
            "firstname",
            "lastname",
          ]);
          contactEmail = String(properties.email || "").trim();
          contactName = [properties.firstname, properties.lastname]
            .map((part) => String(part || "").trim())
            .filter(Boolean)
            .join(" ");
        }
        if (cancelled) return;
        setEmail(contactEmail);
        setName(contactName);
        if (!contactEmail) {
          setStatusType("warning");
          setStatusMessage("This contact has no email address.");
          return;
        }
        await refresh(contactEmail);
      } catch (error) {
        if (!cancelled) {
          setStatusType("error");
          setStatusMessage(error.message || "Could not load customer data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [actions, refresh]);

  const runAction = async (payload, successFallback) => {
    setBusy(true);
    setStatusMessage("");
    try {
      const data = await callApi({ email, name, ...payload });
      setProfile(data);
      setTagToAdd("");
      setStatusType("success");
      setStatusMessage(data.message || successFallback);
    } catch (error) {
      setStatusType("error");
      setStatusMessage(error.message || "Request failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading Kit and ThriveCart" />;

  const kit = profile?.kit;
  const thrivecart = profile?.thrivecart;
  const assignedIds = new Set((kit?.tags || []).map((tag) => tag.id));
  const tagOptions = (kit?.availableTags || [])
    .filter((tag) => !assignedIds.has(tag.id))
    .map((tag) => ({ label: tag.name, value: tag.id }));

  return (
    <Flex direction="column" gap="md">
      {statusMessage ? <Alert title={statusMessage} variant={statusType} /> : null}
      <Text>Email: {email || "Missing"}</Text>

      <Heading>Kit</Heading>
      {profile?.errors?.kit ? (
        <ErrorState title="Kit lookup failed">{profile.errors.kit}</ErrorState>
      ) : !kit?.found ? (
        <EmptyState title="Not in Kit" layout="vertical">
          <Text>Adding a tag creates the subscriber.</Text>
        </EmptyState>
      ) : (
        <Flex direction="column" gap="sm">
          <StatusTag variant={kit.state === "active" ? "success" : "default"}>
            {kit.state || "subscriber"}
          </StatusTag>
          {kit.tags.length ? (
            <Flex direction="column" gap="xs">
              {kit.tags.map((tag) => (
                <Flex key={tag.id} direction="row" gap="sm" align="center">
                  <Tag>{tag.name}</Tag>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => runAction({ action: "remove_tag", tagId: tag.id }, "Kit tag removed.")}
                  >
                    Remove
                  </Button>
                </Flex>
              ))}
            </Flex>
          ) : (
            <Text>No tags on this subscriber.</Text>
          )}
        </Flex>
      )}
      {tagOptions.length ? (
        <Flex direction="row" gap="sm" align="end">
          <Select
            name="tagToAdd"
            label="Add Kit tag"
            placeholder="Choose a tag"
            value={tagToAdd}
            onChange={setTagToAdd}
            options={tagOptions}
          />
          <Button
            variant="primary"
            disabled={busy || !tagToAdd || !email}
            onClick={() => runAction({ action: "add_tag", tagId: tagToAdd }, "Kit tag added.")}
          >
            Add tag
          </Button>
        </Flex>
      ) : (
        <Text>No more Kit tags to add.</Text>
      )}

      <Divider />

      <Heading>ThriveCart</Heading>
      {profile?.errors?.thrivecart ? (
        <ErrorState title="ThriveCart lookup failed">{profile.errors.thrivecart}</ErrorState>
      ) : (
        <Flex direction="column" gap="sm">
          <StatusTag variant={thrivecart?.active ? "success" : "default"}>
            {thrivecart?.active ? "Active subscription" : "No active subscription"}
          </StatusTag>
          {!thrivecart?.found ? <Text>No ThriveCart customer for this email.</Text> : null}
          {thrivecart?.subscriptions?.length ? (
            <DescriptionList direction="column">
              {thrivecart.subscriptions.map((subscription) => (
                <DescriptionListItem
                  key={subscription.id}
                  label={`${subscription.name} (${subscription.status})`}
                >
                  <Text>
                    {[subscription.amount, subscription.frequency].filter(Boolean).join(" / ") || "—"}
                  </Text>
                </DescriptionListItem>
              ))}
            </DescriptionList>
          ) : null}
        </Flex>
      )}
      <Flex direction="column" gap="sm">
        <Alert
          title="Only create a student if the agreement was sent and signed through Google Docs."
          variant="warning"
        />
        <Text>
          Create a ThriveCart student for course {COURSE_ID}. This sends the course access email.
        </Text>
        <Button
          variant="primary"
          disabled={busy || !email}
          onClick={() =>
            runAction(
              { action: "create_student", name },
              `ThriveCart student created for course ${COURSE_ID}.`
            )
          }
        >
          Create student
        </Button>
      </Flex>
    </Flex>
  );
};
