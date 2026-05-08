-- Move invite_client up to position 3 so the post-session step is "now invite
-- a client to put in this slot" rather than diverting back into settings.
-- Two-pass UPDATE so re-runs are idempotent and ordering collisions are
-- harmless (column has no unique constraint).

UPDATE onboarding_steps SET "order" = 7 WHERE key = 'achievements';
UPDATE onboarding_steps SET "order" = 6 WHERE key = 'program_package';
UPDATE onboarding_steps SET "order" = 5 WHERE key = 'intake_form';
UPDATE onboarding_steps SET "order" = 4 WHERE key = 'business_profile';
UPDATE onboarding_steps SET "order" = 3 WHERE key = 'invite_client';
