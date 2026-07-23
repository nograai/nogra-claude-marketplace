// Nogra's bundled JSON Schema validator.
//
// This is deliberately a closed validation profile, not a general-purpose
// implementation of every JSON Schema vocabulary. Every schema keyword used
// by the plugin's bundled Draft 2020-12 contracts is enforced here. The
// contract smoke fails when a bundled schema introduces an unsupported keyword,
// so validation cannot silently degrade to partial hand-written checks.

import fs from "node:fs";

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$id",
  "$schema",
  "additionalProperties",
  "const",
  "default",
  "description",
  "enum",
  "format",
  "items",
  "minItems",
  "minLength",
  "pattern",
  "properties",
  "required",
  "title",
  "type"
]);

const ANNOTATION_KEYWORDS = new Set([
  "$id",
  "$schema",
  "default",
  "description",
  "title"
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function instanceType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isObject(value)) return "object";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, wanted) {
  if (wanted === "number") return typeof value === "number" && Number.isFinite(value);
  if (wanted === "integer") return Number.isInteger(value);
  if (wanted === "object") return isObject(value);
  if (wanted === "array") return Array.isArray(value);
  if (wanted === "null") return value === null;
  return typeof value === wanted;
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function pushError(errors, instancePath, schemaPath, keyword, message, actual) {
  errors.push({
    instancePath,
    schemaPath,
    keyword,
    message,
    ...(actual === undefined ? {} : { actual })
  });
}

function isDateTime(value) {
  if (typeof value !== "string") return false;
  const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
  return rfc3339.test(value) && Number.isFinite(Date.parse(value));
}

function sameJsonValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameJsonValue(item, right[index]));
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(left[key], right[key]));
  }
  return false;
}

function validateNode(schema, value, instancePath, schemaPath, errors) {
  if (schema === true) return;
  if (schema === false) {
    pushError(errors, instancePath, schemaPath, "falseSchema", "value is rejected by the schema");
    return;
  }
  if (!isObject(schema)) {
    throw new Error(`invalid JSON Schema node at ${schemaPath || "/"}`);
  }

  if (Object.hasOwn(schema, "type")) {
    const wanted = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!wanted.some((type) => matchesType(value, type))) {
      pushError(
        errors,
        instancePath,
        `${schemaPath}/type`,
        "type",
        `must be ${wanted.join(" or ")}`,
        instanceType(value)
      );
      return;
    }
  }

  if (Object.hasOwn(schema, "const") && !sameJsonValue(value, schema.const)) {
    pushError(errors, instancePath, `${schemaPath}/const`, "const", "must equal the contract constant", value);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameJsonValue(item, value))) {
    pushError(errors, instancePath, `${schemaPath}/enum`, "enum", "must be one of the allowed values", value);
  }

  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && [...value].length < schema.minLength) {
      pushError(errors, instancePath, `${schemaPath}/minLength`, "minLength", `must contain at least ${schema.minLength} characters`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      pushError(errors, instancePath, `${schemaPath}/pattern`, "pattern", `must match ${schema.pattern}`, value);
    }
    if (schema.format === "date-time" && !isDateTime(value)) {
      pushError(errors, instancePath, `${schemaPath}/format`, "format", "must be an RFC 3339 date-time", value);
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      pushError(errors, instancePath, `${schemaPath}/minItems`, "minItems", `must contain at least ${schema.minItems} items`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        validateNode(
          schema.items,
          item,
          `${instancePath}/${index}`,
          `${schemaPath}/items`,
          errors
        );
      });
    }
  }

  if (isObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!Object.hasOwn(value, key)) {
        pushError(
          errors,
          instancePath,
          `${schemaPath}/required`,
          "required",
          `must contain required property ${key}`
        );
      }
    }

    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (!Object.hasOwn(value, key)) continue;
      validateNode(
        childSchema,
        value[key],
        `${instancePath}/${pointerSegment(key)}`,
        `${schemaPath}/properties/${pointerSegment(key)}`,
        errors
      );
    }

    const extraKeys = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
    if (schema.additionalProperties === false) {
      for (const key of extraKeys) {
        pushError(
          errors,
          `${instancePath}/${pointerSegment(key)}`,
          `${schemaPath}/additionalProperties`,
          "additionalProperties",
          `property ${key} is not allowed`
        );
      }
    } else if (isObject(schema.additionalProperties) || typeof schema.additionalProperties === "boolean") {
      for (const key of extraKeys) {
        validateNode(
          schema.additionalProperties,
          value[key],
          `${instancePath}/${pointerSegment(key)}`,
          `${schemaPath}/additionalProperties`,
          errors
        );
      }
    }
  }
}

function assertSchemaNodeSupported(schema, schemaPath = "") {
  if (typeof schema === "boolean") return;
  if (!isObject(schema)) throw new Error(`invalid JSON Schema node at ${schemaPath || "/"}`);
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      throw new Error(`unsupported bundled JSON Schema keyword ${keyword} at ${schemaPath || "/"}`);
    }
  }
  if (isObject(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      assertSchemaNodeSupported(child, `${schemaPath}/properties/${pointerSegment(key)}`);
    }
  }
  if (schema.items !== undefined) {
    assertSchemaNodeSupported(schema.items, `${schemaPath}/items`);
  }
  if (isObject(schema.additionalProperties)) {
    assertSchemaNodeSupported(schema.additionalProperties, `${schemaPath}/additionalProperties`);
  }
  for (const keyword of ANNOTATION_KEYWORDS) {
    if (Object.hasOwn(schema, keyword) && schema[keyword] === undefined) {
      throw new Error(`undefined annotation ${keyword} at ${schemaPath || "/"}`);
    }
  }
}

export function readJsonSchema(file) {
  const schema = JSON.parse(fs.readFileSync(file, "utf8"));
  assertSchemaNodeSupported(schema);
  return schema;
}

export function assertBundledSchemaSupported(schema) {
  assertSchemaNodeSupported(schema);
  return true;
}

export function validateJsonSchema(schema, value) {
  assertSchemaNodeSupported(schema);
  const errors = [];
  validateNode(schema, value, "", "", errors);
  return {
    valid: errors.length === 0,
    errors
  };
}

export function assertJsonSchema(schema, value, label = "contract") {
  const result = validateJsonSchema(schema, value);
  if (!result.valid) {
    const error = new Error(
      `${label} validation failed: ${result.errors.map((item) => `${item.instancePath || "/"} ${item.message}`).join("; ")}`
    );
    error.validationErrors = result.errors;
    throw error;
  }
  return value;
}
