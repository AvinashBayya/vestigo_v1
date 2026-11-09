/**
 * Cron expression validation for scheduled target monitoring.
 *
 * Validates standard 5-part cron syntax:
 * [minute] [hour] [day-of-month] [month] [day-of-week]
 *
 * Supported specifiers:
 * - Asterisk: *
 * - Number within range
 * - Range: X-Y
 * - Step: * /N or X-Y/N
 * - List: A,B,C
 */

export type CronValidationResult =
  { readonly isValid: true } | { readonly isValid: false; readonly error: string };

/** A single field's validation: an error message is always present on failure. */
type FieldValidation = { readonly valid: true } | { readonly valid: false; readonly error: string };

const FIELD_BOUNDS: readonly {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 6 },
];

function validateField(
  field: string,
  min: number,
  max: number,
  fieldName: string,
): FieldValidation {
  if (field === "*") return { valid: true };

  const subItems = field.split(",");
  for (const item of subItems) {
    if (item.length === 0) {
      return { valid: false, error: `Invalid empty item in ${fieldName} list` };
    }

    // Step format: */N or X-Y/N or N/N
    if (item.includes("/")) {
      const parts = item.split("/");
      if (parts.length !== 2) {
        return { valid: false, error: `Invalid step syntax in ${fieldName}: ${item}` };
      }
      const [rangePart, stepPart] = parts;
      const step = Number(stepPart);
      if (!Number.isInteger(step) || step <= 0) {
        return { valid: false, error: `Step in ${fieldName} must be a positive integer: ${item}` };
      }

      if (rangePart !== undefined && rangePart !== "*") {
        const rangeRes = validateRangeOrNumber(rangePart, min, max, fieldName);
        if (!rangeRes.valid) return rangeRes;
      }
      continue;
    }

    // Range format: X-Y or single number
    const rangeRes = validateRangeOrNumber(item, min, max, fieldName);
    if (!rangeRes.valid) return rangeRes;
  }

  return { valid: true };
}

function validateRangeOrNumber(
  item: string,
  min: number,
  max: number,
  fieldName: string,
): FieldValidation {
  if (item.includes("-")) {
    const parts = item.split("-");
    if (parts.length !== 2) {
      return { valid: false, error: `Invalid range in ${fieldName}: ${item}` };
    }
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return { valid: false, error: `Range values in ${fieldName} must be integers: ${item}` };
    }
    if (start < min || start > max || end < min || end > max) {
      return {
        valid: false,
        error: `Range ${item} in ${fieldName} outside allowed bounds [${String(min)}-${String(max)}]`,
      };
    }
    if (start > end) {
      return {
        valid: false,
        error: `Range start cannot exceed end in ${fieldName}: ${item}`,
      };
    }
    return { valid: true };
  }

  const num = Number(item);
  if (!Number.isInteger(num)) {
    return { valid: false, error: `Value in ${fieldName} must be an integer: ${item}` };
  }
  if (num < min || num > max) {
    return {
      valid: false,
      error: `Value ${item} in ${fieldName} outside allowed bounds [${String(min)}-${String(max)}]`,
    };
  }
  return { valid: true };
}

export function validateCronExpression(expression: string): CronValidationResult {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return { isValid: false, error: "Cron expression cannot be blank" };
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return {
      isValid: false,
      error: `Cron expression must contain exactly 5 fields (minute, hour, day-of-month, month, day-of-week). Found ${String(fields.length)} fields.`,
    };
  }

  for (let i = 0; i < 5; i++) {
    const field = fields[i];
    const bounds = FIELD_BOUNDS[i];
    if (field === undefined || bounds === undefined) continue;
    const res = validateField(field, bounds.min, bounds.max, bounds.name);
    if (!res.valid) {
      return { isValid: false, error: res.error };
    }
  }

  return { isValid: true };
}
