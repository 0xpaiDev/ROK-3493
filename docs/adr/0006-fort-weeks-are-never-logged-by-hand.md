# Fort Weeks are never logged by hand

The reader records Fort Weeks automatically, so the site does not need a hand-entry feature and carries no code for one. The Council's only part in a Fort Week's rows is Picking a Governor for a "needs ID" row. A rare correction is made directly in SQL instead.

## Consequences

The database still lets a Council sign-in write Fort Week rows. That is acceptable while one person runs the Council and holds SQL access, and needs revisiting before anyone else gets access.
