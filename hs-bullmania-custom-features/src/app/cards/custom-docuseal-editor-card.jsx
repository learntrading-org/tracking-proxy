import React, { useState, useEffect } from "react";
import {
  Divider,
  Input,
  NumberInput,
  DateInput,
  Select,
  TextArea,
  Button,
  Text,
  Heading,
  Flex,
  Box,
  Alert,
  hubspot
} from "@hubspot/ui-extensions";

hubspot.extend(({ context, actions }) => (
  <CustomDocusealEditor context={context} actions={actions} />
));

const PRESETS = {
  full: JSON.stringify([
    "BullMania Trading Courses",
    "MoneyScanner",
    "BullMania™ MoneyLine and BullMania™ Bullmarket Support Band Indicators",
    "Private Discord Server",
    "Technical Analysis Reports",
    "Private Live Streams",
    "BullMania AI",
    "Private Market Analysis Videos",
    "3 Private Coaching Session(s)"
  ], null, 2),
  no_sessions: JSON.stringify([
    "BullMania Trading Courses",
    "MoneyScanner",
    "BullMania™ MoneyLine and BullMania™ Bullmarket Support Band Indicators",
    "Private Discord Server",
    "Technical Analysis Reports",
    "Private Live Streams",
    "BullMania AI",
    "Private Market Analysis Videos"
  ], null, 2),
  custom_only: JSON.stringify([
    "BullMania Trading Courses",
    "MoneyScanner",
    "BullMania™ MoneyLine and BullMania™ Bullmarket Support Band Indicators",
    "Private Discord Server",
    "Technical Analysis Reports",
    "Private Live Streams",
    "BullMania AI",
    "Private Market Analysis Videos",
    "3 Private Coaching Session(s)",
    "2 Portfolio Review(s) by Ivan"
  ], null, 2)
};

const CustomDocusealEditor = ({ context, actions }) => {
  const [programFee, setProgramFee] = useState(4999);
  const [endDate, setEndDate] = useState({ year: 2026, month: 11, date: 31 });
  const [selectedPreset, setSelectedPreset] = useState("full");
  const [programDeliverables, setProgramDeliverables] = useState(PRESETS.full);
  const [isAgreementAlreadySent, setIsAgreementAlreadySent] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [statusType, setStatusType] = useState("info");
  const [isLoading, setIsLoading] = useState(false);

  // Attempt to fetch existing properties when component mounts
  useEffect(() => {
    if (actions && actions.fetchCrmObjectProperties) {
      actions.fetchCrmObjectProperties(["program_fee", "end_date", "program_deliverables", "agreement_required", "custom_agreement_required"])
        .then((properties) => {
          if (properties.program_fee) setProgramFee(Number(properties.program_fee));
          if (properties.end_date) {
            const d = new Date(Number(properties.end_date));
            if (!isNaN(d.getTime())) {
              setEndDate({ year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate() });
            }
          }
          if (properties.program_deliverables) {
            setProgramDeliverables(properties.program_deliverables);
            setSelectedPreset("custom");
          }

          let alreadySent = false;
          if (properties.agreement_required) {
            const val1 = String(properties.agreement_required).toLowerCase();
            if (val1 === "yes" || val1 === "true") alreadySent = true;
          }
          if (properties.custom_agreement_required) {
            const val2 = String(properties.custom_agreement_required).toLowerCase();
            if (val2 === "yes" || val2 === "true") alreadySent = true;
          }
          setIsAgreementAlreadySent(alreadySent);
        })
        .catch((err) => {
          console.warn("Could not fetch initial CRM properties:", err);
        });
    }
  }, [actions]);

  const handlePresetChange = (value) => {
    setSelectedPreset(value);
    if (PRESETS[value]) {
      setProgramDeliverables(PRESETS[value]);
    }
  };

  const handleSaveDraft = () => {
    setIsLoading(true);
    setStatusMessage(null);

    // Validate JSON format to ensure backend compatibility
    try {
      const parsed = JSON.parse(programDeliverables);
      if (!Array.isArray(parsed)) {
        setStatusType("error");
        setStatusMessage("Deliverables must be a valid JSON array of strings.");
        setIsLoading(false);
        return;
      }
    } catch (e) {
      setStatusType("error");
      setStatusMessage("Deliverables format is not valid JSON.");
      setIsLoading(false);
      return;
    }

    let formattedDate = endDate;
    if (endDate && typeof endDate === "object" && endDate.year) {
      // HubSpot expects midnight UTC timestamps for Date properties
      formattedDate = new Date(Date.UTC(endDate.year, endDate.month, endDate.date)).getTime();
    }

    hubspot.fetch("https://tracking-proxy-mocha.vercel.app/api/hubspot/update-contact", {
      method: "POST",
      body: {
        contactId: context.crm.objectId,
        properties: {
          program_fee: programFee,
          end_date: formattedDate,
          program_deliverables: programDeliverables
        }
      }
    })
      .then((response) => {
        return response.json().then((data) => ({ status: response.status, data }));
      })
      .then(({ status, data }) => {
        if (status >= 200 && status < 300 && data.status === "SUCCESS") {
          if (actions && actions.refreshObjectProperties) {
            actions.refreshObjectProperties();
          }
          setStatusType("success");
          setStatusMessage("Successfully saved draft properties to Contact.");
        } else {
          throw new Error(data.error || "Unknown server error");
        }
      })
      .catch((err) => {
        setStatusType("error");
        setStatusMessage(`Failed to save properties: ${err.message}`);
        console.error("Save error:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const handleTriggerAgreement = () => {
    setIsLoading(true);
    setStatusMessage(null);

    // Validate JSON format to ensure backend compatibility
    try {
      const parsed = JSON.parse(programDeliverables);
      if (!Array.isArray(parsed)) {
        setStatusType("error");
        setStatusMessage("Deliverables must be a valid JSON array of strings.");
        setIsLoading(false);
        return;
      }
    } catch (e) {
      setStatusType("error");
      setStatusMessage("Deliverables format is not valid JSON.");
      setIsLoading(false);
      return;
    }

    let formattedDate = endDate;
    if (endDate && typeof endDate === "object" && endDate.year) {
      // HubSpot expects midnight UTC timestamps for Date properties
      formattedDate = new Date(Date.UTC(endDate.year, endDate.month, endDate.date)).getTime();
    }

    hubspot.fetch("https://tracking-proxy-mocha.vercel.app/api/hubspot/update-contact", {
      method: "POST",
      body: {
        contactId: context.crm.objectId,
        properties: {
          program_fee: programFee,
          end_date: formattedDate,
          program_deliverables: programDeliverables,
          custom_agreement_required: "true"
        }
      }
    })
      .then((response) => {
        return response.json().then((data) => ({ status: response.status, data }));
      })
      .then(({ status, data }) => {
        if (status >= 200 && status < 300 && data.status === "SUCCESS") {
          if (actions && actions.refreshObjectProperties) {
            actions.refreshObjectProperties();
          }
          setIsAgreementAlreadySent(true);
          setStatusType("success");
          setStatusMessage("Successfully saved properties and triggered custom agreement!");
        } else {
          throw new Error(data.error || "Unknown server error");
        }
      })
      .catch((err) => {
        setStatusType("error");
        setStatusMessage(`Failed to save properties and trigger agreement: ${err.message}`);
        console.error("Save error:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  return (
    <Flex direction="column" gap="medium">
      <Box>
        <Heading>Agreement Customizer</Heading>
        <Text>Enter personalized details to be merged into the custom DocuSeal agreement.</Text>
      </Box>

      <Divider />

      <Box>
        <Text>Program Fee (USD)</Text>
        <NumberInput
          name="programFee"
          value={programFee}
          onChange={(value) => setProgramFee(value)}
        />
      </Box>

      <Box>
        <Text>End Date</Text>
        <DateInput
          name="endDate"
          value={endDate}
          onChange={(value) => setEndDate(value)}
        />
      </Box>

      <Divider />

      <Box>
        <Heading>Program Deliverables</Heading>
        <Text>Select a reusable preset template to pre-fill standard content:</Text>
        <Select
          value={selectedPreset}
          onChange={handlePresetChange}
          options={[
            { label: "1-on-1 Included (Full Deliverables)", value: "full" },
            { label: "1-on-1 Not Included", value: "no_sessions" },
            { label: "25k Deal", value: "custom_only" },
            { label: "Custom / Edited Content", value: "custom" }
          ]}
        />
      </Box>

      <Box>
        <Text>Deliverables JSON / Content Editor</Text>
        <TextArea
          name="programDeliverables"
          value={programDeliverables}
          rows={8}
          onInput={(value) => {
            setProgramDeliverables(value);
            setSelectedPreset("custom");
          }}
          onChange={(value) => {
            setProgramDeliverables(value);
            setSelectedPreset("custom");
          }}
        />
        <Text>Ensure property format aligns with backend template expected structure.</Text>
      </Box>

      {statusMessage && (
        <Alert title={statusType === "success" ? "Success" : statusType === "warning" ? "Warning" : "Notice"} variant={statusType}>
          {statusMessage}
        </Alert>
      )}

      {isAgreementAlreadySent && (
        <Alert title="Agreement Already Sent" variant="info">
          An agreement has already been triggered for this contact.
        </Alert>
      )}

      <Flex direction="row" gap="small">
        <Button
          onClick={handleSaveDraft}
          disabled={isLoading || isAgreementAlreadySent}
        >
          {isLoading ? "Saving..." : "Save Draft"}
        </Button>
        <Button
          variant="primary"
          onClick={handleTriggerAgreement}
          disabled={isLoading || isAgreementAlreadySent}
        >
          {isLoading ? "Triggering..." : "Send Agreement"}
        </Button>
      </Flex>
    </Flex>
  );
};

export default CustomDocusealEditor;
