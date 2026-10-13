ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX users_username_unique ON users(username COLLATE NOCASE) WHERE username IS NOT NULL;
