-- Remove seeded intake custom fields that duplicated built-in dog fields
-- ("Dog's breed" ↔ Breed, "Dog's age" ↔ Date of birth) or are out of scope
-- ("Vaccinations up to date?"). New accounts no longer seed these (see
-- lib/onboarding/form-defaults.ts). CustomFieldValue rows cascade-delete.
DELETE FROM "custom_fields"
WHERE "category" = 'INTAKE'
  AND "label" IN ('Dog''s breed', 'Dog''s age (months/years)', 'Vaccinations up to date?');
