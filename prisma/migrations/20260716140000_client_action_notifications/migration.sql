-- Client-action trainer notifications: a trainer now gets a live in-app
-- notification (feed + toast + push + email) when a client books a session /
-- enrols in a class, cancels one, or buys/requests a shop product.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_BOOKED_SESSION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_CANCELLED_SESSION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_SHOP_ORDER';
