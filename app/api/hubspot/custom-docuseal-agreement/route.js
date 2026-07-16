// app/api/hubspot/custom-docuseal-agreement/route.js
import { NextResponse } from "next/server";
import fs from 'fs';
import path from 'path';

// Handle CORS preflight requests
export async function OPTIONS(request) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// Handle the main webhook POST request
export async function POST(request) {
  try {
    const payload = await request.json();

    const { fields = {} } = payload;
    
    console.log("HubSpot Payload Fields:", JSON.stringify(fields, null, 2));

    // Helper for case-insensitive extraction
    const getField = (keys) => {
      for (const key of keys) {
        if (fields[key] !== undefined && fields[key] !== null) return fields[key];
        const lowerKey = Object.keys(fields).find(k => k.toLowerCase() === key.toLowerCase());
        if (lowerKey) return fields[lowerKey];
      }
      return "";
    };

    const email = getField(['email']);
    const firstName = getField(['firstName', 'first_name']);
    const lastName = getField(['lastName', 'last_name']);
    
    // Extract new custom fields (HubSpot internal names are often snake_case)
    const programFeeRaw = getField(['PROGRAM_FEE', 'programFee', 'program_fee']);
    const endDateRaw = getField(['END_DATE', 'endDate', 'end_date']);
    const programDeliverables = getField(['PROGRAM_DELIVERABLES', 'programDeliverables', 'program_deliverables']) || [];

    // Format the Fee
    let formattedFee = programFeeRaw;
    if (formattedFee) {
      const numericFee = parseFloat(String(formattedFee).replace(/[^\d.-]/g, ''));
      if (!isNaN(numericFee)) {
        formattedFee = new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        }).format(numericFee);
      }
    }

    // Format the Date
    let formattedDate = endDateRaw;
    if (formattedDate) {
      const isNumericTimestamp = !isNaN(Number(formattedDate)) && String(formattedDate).trim() !== '';
      const timestamp = isNumericTimestamp ? Number(formattedDate) : formattedDate;
      const dateObj = new Date(timestamp);
      
      if (!isNaN(dateObj.getTime())) {
        formattedDate = new Intl.DateTimeFormat('en-US', {
          month: 'long',
          day: '2-digit',
          year: 'numeric'
        }).format(dateObj);
      }
    }

    const apiToken = process.env.DOCUSEAL_API_TOKEN;

    if (!apiToken) {
      throw new Error("DocuSeal API token is not set");
    }

    const submitter = {
      email,
      role: "Platinum Signer",
      external_id: "BULLMANIA_CUSTOM_AGREEMENT",
    };

    let fullName;
    if (firstName) {
      fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`;
      submitter.name = fullName;
      submitter.fields = [
        {
          name: "FIRST NAME",
          default_value: firstName,
          readonly: false,
        },
        {
          name: "LAST NAME",
          default_value: lastName || "",
          readonly: false,
        },
      ];
    }
    
    // Handle programDeliverables which should be an array of strings
    let parsedDeliverables = [];
    if (Array.isArray(programDeliverables)) {
      parsedDeliverables = programDeliverables;
    } else if (typeof programDeliverables === "string") {
      try {
        parsedDeliverables = JSON.parse(programDeliverables);
      } catch (e) {
        // Fallback: split by newlines
        parsedDeliverables = programDeliverables.split("\n").map(d => d.trim()).filter(Boolean);
      }
    }

    // Format deliverables as an HTML unordered list to avoid DocuSeal DOCX parser errors
    let deliverablesHtml = "";
    if (parsedDeliverables.length > 0) {
      deliverablesHtml = "<ul>" + parsedDeliverables.map(d => {
        let decodedStr = String(d);
        
        // Decode &amp; completely in case of multiple encodings (e.g. &amp;amp;#x2122;)
        let prev = "";
        while (decodedStr !== prev) {
          prev = decodedStr;
          decodedStr = decodedStr.replace(/&amp;/gi, '&');
        }
        
        // Replace all HTML entities for the trademark symbol with the actual unicode character '™'.
        // HubSpot recently started sending these as HTML entities, which DocuSeal doesn't decode natively.
        decodedStr = decodedStr
          .replace(/&#x2122;/gi, '™')
          .replace(/&#8482;/gi, '™')
          .replace(/&trade;/gi, '™')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&#x27;/g, "'");
          
        return `<li>${decodedStr}</li>`;
      }).join("") + "</ul>";
    }

    // Read the DOCX file and convert to base64
    const docxPath = path.join(process.cwd(), 'app', 'api', 'hubspot', 'custom-docuseal-agreement', 'template.docx');
    const base64File = fs.readFileSync(docxPath).toString('base64');

    const requestBody = {
      name: "BULLMANIA CUSTOM AGREEMENT",
      documents: [
        {
          name: "MASTER BULLMANIA PLATINUM AGREEMENT - CUSTOM.docx",
          file: base64File
        }
      ],
      submitters: [submitter],
      variables: {
        PROGRAM_FEE: formattedFee || "",
        END_DATE: formattedDate || "",
        PROGRAM_DELIVERABLES: deliverablesHtml
      },
      send_email: true,
      message: {
        subject: 'eSignature request for "BULLMANIA PLATINUM AGREEMENT"',
        body: "Hi there, \n\nWelcome to Bullmania, and thank you for joining us! \n\nYour agreement has been sent for your eSignature. Please click the link below to review and sign the document:\n{{submitter.link}} \n\nIf your subscription includes 1-on-1 coaching, our team will reach out shortly to schedule your first session.\n\nIf you have any questions, feel free to contact us at hello@bullmania.com.\n\nThank you and welcome aboard,\nThe Bullmania Team",
      },
    };

    const response = await fetch("https://api.docuseal.eu/submissions/docx", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Auth-Token": apiToken,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`DocuSeal API error: ${await response.text()}`);
    }

    // Return success response with the requested format
    return NextResponse.json(
      {
        status: "success",
        statusCode: 200,
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error processing webhook:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
