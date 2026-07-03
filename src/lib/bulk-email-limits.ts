// Daily recipient caps for trainer→client bulk email. Trial trainers are tightly
// capped to protect deliverability while they evaluate; paid trainers get a high
// backstop that exists only to catch abuse/bugs. Kept in a lib (not the route
// module) because Next.js route files may only export handlers + config.
export const TRIAL_DAILY_RECIPIENT_LIMIT = 5
export const PAID_DAILY_RECIPIENT_LIMIT = 500
