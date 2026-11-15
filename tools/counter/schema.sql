-- Counts only: how many pings (or ratings) came in on a day for a version and a system. Nothing identifies a sender.
CREATE TABLE IF NOT EXISTS pings (
  day TEXT NOT NULL,   -- UTC, YYYY-MM-DD
  v TEXT NOT NULL,     -- app version
  os TEXT NOT NULL,    -- win32, linux, darwin
  n INTEGER NOT NULL,
  PRIMARY KEY (day, v, os)
);

CREATE TABLE IF NOT EXISTS ratings (
  day TEXT NOT NULL,
  v TEXT NOT NULL,
  os TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  n INTEGER NOT NULL,
  PRIMARY KEY (day, v, os, stars)
);
