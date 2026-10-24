CREATE TABLE IF NOT EXISTS ie_checkout_requests(account_id TEXT NOT NULL REFERENCES ie_accounts(id) ON DELETE CASCADE,request_id TEXT NOT NULL,session_id TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,completed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,request_id));
CREATE TABLE IF NOT EXISTS ie_billing_sync(subscription_id TEXT PRIMARY KEY,generation INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS ie_checkout_locks(account_id TEXT PRIMARY KEY REFERENCES ie_accounts(id) ON DELETE CASCADE,request_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
