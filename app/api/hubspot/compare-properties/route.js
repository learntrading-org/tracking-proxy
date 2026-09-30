// app/api/hubspot/compare-properties/route.js
import { NextResponse } from "next/server";

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

function normalizeValue(val) {
  if (val === null || val === undefined) return "";
  return String(val);
}

function parseNumber(val) {
  if (val === null || val === undefined || String(val).trim() === "") return NaN;
  const num = Number(val);
  return Number.isFinite(num) ? num : NaN;
}

function parseDate(val) {
  if (!val || String(val).trim() === "") return NaN;
  const timestamp = Date.parse(val);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function pickSide(propertyValue, staticValue) {
  if (propertyValue !== undefined && propertyValue !== null && String(propertyValue).trim() !== "") {
    return propertyValue;
  }
  if (staticValue !== undefined && staticValue !== null) return staticValue;
  if (propertyValue !== undefined && propertyValue !== null) return propertyValue;
  return "";
}

function evaluateComparison({ value1, value2, operator, case_sensitive }) {
  const isCaseSensitive = case_sensitive === "true" || case_sensitive === true;

  // Unary operators
  if (operator === "is_empty") {
    return value1 === null || value1 === undefined || String(value1).trim() === "";
  }
  if (operator === "is_not_empty") {
    return value1 !== null && value1 !== undefined && String(value1).trim() !== "";
  }

  const str1 = normalizeValue(value1);
  const str2 = normalizeValue(value2);

  // Check if numeric comparison applies
  const num1 = parseNumber(str1.trim());
  const num2 = parseNumber(str2.trim());
  const bothNumbers = !isNaN(num1) && !isNaN(num2);

  // Check if date comparison applies for inequality operators
  const date1 = parseDate(str1.trim());
  const date2 = parseDate(str2.trim());
  const bothDates = !isNaN(date1) && !isNaN(date2) && (isNaN(num1) || isNaN(num2));

  switch (operator) {
    case "equals": {
      if (bothNumbers) {
        return num1 === num2;
      }
      if (isCaseSensitive) {
        return str1.trim() === str2.trim();
      }
      return str1.trim().toLowerCase() === str2.trim().toLowerCase();
    }
    case "not_equals": {
      if (bothNumbers) {
        return num1 !== num2;
      }
      if (isCaseSensitive) {
        return str1.trim() !== str2.trim();
      }
      return str1.trim().toLowerCase() !== str2.trim().toLowerCase();
    }
    case "greater_than": {
      if (bothNumbers) return num1 > num2;
      if (bothDates) return date1 > date2;
      return isCaseSensitive ? str1 > str2 : str1.toLowerCase() > str2.toLowerCase();
    }
    case "greater_than_or_equal": {
      if (bothNumbers) return num1 >= num2;
      if (bothDates) return date1 >= date2;
      return isCaseSensitive ? str1 >= str2 : str1.toLowerCase() >= str2.toLowerCase();
    }
    case "less_than": {
      if (bothNumbers) return num1 < num2;
      if (bothDates) return date1 < date2;
      return isCaseSensitive ? str1 < str2 : str1.toLowerCase() < str2.toLowerCase();
    }
    case "less_than_or_equal": {
      if (bothNumbers) return num1 <= num2;
      if (bothDates) return date1 <= date2;
      return isCaseSensitive ? str1 <= str2 : str1.toLowerCase() <= str2.toLowerCase();
    }
    case "contains": {
      const s1 = isCaseSensitive ? str1 : str1.toLowerCase();
      const s2 = isCaseSensitive ? str2 : str2.toLowerCase();
      return s1.includes(s2);
    }
    case "not_contains": {
      const s1 = isCaseSensitive ? str1 : str1.toLowerCase();
      const s2 = isCaseSensitive ? str2 : str2.toLowerCase();
      return !s1.includes(s2);
    }
    case "starts_with": {
      const s1 = isCaseSensitive ? str1 : str1.toLowerCase();
      const s2 = isCaseSensitive ? str2 : str2.toLowerCase();
      return s1.startsWith(s2);
    }
    case "ends_with": {
      const s1 = isCaseSensitive ? str1 : str1.toLowerCase();
      const s2 = isCaseSensitive ? str2 : str2.toLowerCase();
      return s1.endsWith(s2);
    }
    default:
      throw new Error(`Unsupported operator: ${operator}`);
  }
}

// Handle the main HubSpot webhook POST request
export async function POST(request) {
  try {
    const payload = await request.json();

    const fields = payload.fields || {};
    const { operator = "equals", case_sensitive = "false" } = fields;
    const value1 = pickSide(fields.value1, fields.value1_static);
    const value2 = pickSide(fields.value2, fields.value2_static);

    const isMatch = Boolean(
      evaluateComparison({
        value1,
        value2,
        operator,
        case_sensitive,
      })
    );

    // Return success response in the exact format HubSpot expects
    return NextResponse.json(
      {
        outputFields: {
          is_match: isMatch,
          result: isMatch,
          result_string: isMatch ? "true" : "false",
        },
      },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error processing compare-properties action:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
