/**
 * Shared validation utilities and localized error message builder.
 *
 * Provides two patterns:
 * 1. Simple field-level validation (ValidationResult) for individual fields.
 * 2. Structured multi-field validation (StructuredValidationResult) for form/object validation.
 */

/** Supported locales for validation error messages. */
export type Locale = 'es' | 'en';

/** Result of a single field validation. */
export interface ValidationResult {
  /** Whether the field value is valid. */
  valid: boolean;
  /** Localized error message when invalid. */
  error?: string;
}

/** Structured validation error with field name, error code, and bilingual messages. */
export interface ValidationError {
  /** The field name that failed validation. */
  field: string;
  /** Machine-readable error code (e.g., 'REQUIRED', 'OUT_OF_RANGE'). */
  code: string;
  /** Bilingual error messages. */
  message: { es: string; en: string };
}

/** Result of a structured multi-field validation. */
export interface StructuredValidationResult {
  /** Whether all fields passed validation. */
  valid: boolean;
  /** Array of validation errors (empty when valid). */
  errors: ValidationError[];
}

/** Translation keys for validation error messages. */
export type ErrorKey =
  | 'required'
  | 'name_too_long'
  | 'email_invalid'
  | 'phone_invalid'
  | 'quantity_invalid'
  | 'age_group_invalid'
  | 'sizes_invalid'
  | 'notes_too_long'
  | 'tracking_invalid'
  | 'measurement_out_of_range'
  | 'file_format_invalid'
  | 'file_size_exceeded'
  | 'dtf_dimension_invalid'
  | 'sublimation_dimension_invalid'
  | 'quote.error.required'
  | 'quote.error.name_too_long'
  | 'quote.error.email_invalid'
  | 'quote.error.phone_invalid'
  | 'quote.error.quantity_invalid'
  | 'quote.error.age_group_invalid'
  | 'quote.error.sizes_invalid'
  | 'quote.error.notes_too_long'
  | 'quote.error.tracking_invalid';

/** Localized error messages for validation. */
const errorMessages: Record<ErrorKey, Record<Locale, string>> = {
  'required': {
    es: 'Este campo es obligatorio',
    en: 'This field is required',
  },
  'name_too_long': {
    es: 'El nombre no puede exceder 100 caracteres',
    en: 'Name cannot exceed 100 characters',
  },
  'email_invalid': {
    es: 'Ingresa un correo electrónico válido',
    en: 'Enter a valid email address',
  },
  'phone_invalid': {
    es: 'Ingresa un teléfono válido con código de país (7-15 dígitos)',
    en: 'Enter a valid phone with country code (7-15 digits)',
  },
  'quantity_invalid': {
    es: 'La cantidad debe ser un número entero entre 1 y 10000',
    en: 'Quantity must be an integer between 1 and 10000',
  },
  'age_group_invalid': {
    es: 'El grupo etario debe ser "children" o "adult"',
    en: 'Age group must be "children" or "adult"',
  },
  'sizes_invalid': {
    es: 'Selecciona al menos una talla válida para el grupo etario',
    en: 'Select at least one valid size for the age group',
  },
  'notes_too_long': {
    es: 'Las notas no pueden exceder 1000 caracteres',
    en: 'Notes cannot exceed 1000 characters',
  },
  'tracking_invalid': {
    es: 'El número de seguimiento debe ser alfanumérico, de 1 a 36 caracteres',
    en: 'Tracking number must be alphanumeric, 1 to 36 characters',
  },
  'measurement_out_of_range': {
    es: 'La medida debe estar entre 10mm (1cm) y 2000mm (200cm)',
    en: 'Measurement must be between 10mm (1cm) and 2000mm (200cm)',
  },
  'file_format_invalid': {
    es: 'Formato de archivo no soportado. Formatos válidos: JPEG, PNG, SVG',
    en: 'Unsupported file format. Valid formats: JPEG, PNG, SVG',
  },
  'file_size_exceeded': {
    es: 'El archivo excede el tamaño máximo de 10MB',
    en: 'File exceeds the maximum size of 10MB',
  },
  'dtf_dimension_invalid': {
    es: 'Las dimensiones DTF deben estar entre 10mm y 500mm por lado',
    en: 'DTF dimensions must be between 10mm and 500mm per side',
  },
  'sublimation_dimension_invalid': {
    es: 'Las dimensiones de sublimación deben estar entre 10mm (1cm) y 1500mm (150cm) por lado',
    en: 'Sublimation dimensions must be between 10mm (1cm) and 1500mm (150cm) per side',
  },
  // Legacy prefixed keys for backward compatibility with existing quote.ts
  'quote.error.required': {
    es: 'Este campo es obligatorio',
    en: 'This field is required',
  },
  'quote.error.name_too_long': {
    es: 'El nombre no puede exceder 100 caracteres',
    en: 'Name cannot exceed 100 characters',
  },
  'quote.error.email_invalid': {
    es: 'Ingresa un correo electrónico válido',
    en: 'Enter a valid email address',
  },
  'quote.error.phone_invalid': {
    es: 'Ingresa un teléfono válido con código de país',
    en: 'Enter a valid phone with country code',
  },
  'quote.error.quantity_invalid': {
    es: 'La cantidad debe ser un número entero entre 1 y 10000',
    en: 'Quantity must be an integer between 1 and 10000',
  },
  'quote.error.age_group_invalid': {
    es: 'El grupo etario debe ser "children" o "adult"',
    en: 'Age group must be "children" or "adult"',
  },
  'quote.error.sizes_invalid': {
    es: 'Selecciona al menos una talla válida para el grupo etario',
    en: 'Select at least one valid size for the age group',
  },
  'quote.error.notes_too_long': {
    es: 'Las notas no pueden exceder 1000 caracteres',
    en: 'Notes cannot exceed 1000 characters',
  },
  'quote.error.tracking_invalid': {
    es: 'El número de seguimiento debe ser alfanumérico, de 1 a 36 caracteres',
    en: 'Tracking number must be alphanumeric, 1 to 36 characters',
  },
};

/**
 * Get a localized error message by key.
 */
export function getErrorMessage(key: ErrorKey, locale: Locale): string {
  return errorMessages[key][locale];
}

/**
 * Get bilingual error messages for a key.
 */
export function getBilingualMessage(key: ErrorKey): { es: string; en: string } {
  return { es: errorMessages[key].es, en: errorMessages[key].en };
}

/**
 * Create a successful validation result.
 */
export function valid(): ValidationResult {
  return { valid: true };
}

/**
 * Create a failed validation result with a localized error message.
 */
export function invalid(key: ErrorKey, locale: Locale): ValidationResult {
  return { valid: false, error: getErrorMessage(key, locale) };
}

/**
 * Create a successful structured validation result.
 */
export function structuredValid(): StructuredValidationResult {
  return { valid: true, errors: [] };
}

/**
 * Create a failed structured validation result.
 */
export function structuredInvalid(errors: ValidationError[]): StructuredValidationResult {
  return { valid: false, errors };
}

/**
 * Build a ValidationError with bilingual messages from an error key.
 */
export function buildError(field: string, code: string, key: ErrorKey): ValidationError {
  return {
    field,
    code,
    message: getBilingualMessage(key),
  };
}

/**
 * Build a ValidationError with custom bilingual messages.
 */
export function buildCustomError(
  field: string,
  code: string,
  message: { es: string; en: string },
): ValidationError {
  return { field, code, message };
}
