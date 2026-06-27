-- Accept payments now defaults ON, so once a trainer connects Stripe their
-- prices are payable without flipping another switch. The connect webhook also
-- turns it on at first onboarding for accounts created before this.
ALTER TABLE "trainer_profiles"
  ALTER COLUMN "acceptPaymentsEnabled" SET DEFAULT true;
