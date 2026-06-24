-- AlterTable
ALTER TABLE "custom_fields" ADD COLUMN     "inQuickAdd" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "trainer_profiles" ADD COLUMN     "clientFieldConfig" JSONB NOT NULL DEFAULT '{}';

