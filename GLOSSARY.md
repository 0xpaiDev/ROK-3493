# Kingdom 3493

The language of the Void Legion's public site for Rise of Kingdoms, Kingdom 3493: its Governors, Fort rankings and rewards.

## Language

**Governor**:
One in-game account that has been seen in Kingdom 3493, identified by its Character ID. A person with three accounts has three Governors.
_Avoid_: player, account, member

**Character ID**:
The game's permanent number for a Governor, and the only thing that identifies one. Names can change; a Character ID does not.
_Avoid_: Governor ID, player ID

**Migrated**:
A Governor who has left for another Kingdom and no longer belongs to this one.

**Owner**:
The person behind a Main and its Farms.
_Avoid_: player, governor (for the person)

**Main**:
The one Governor an Owner treats as their primary account.

**Farm**:
A Governor its Owner keeps to support their Main, usually by gathering resources.
_Avoid_: alt, support account

**Filler Farm**:
A larger Farm that holds troops, used during KvK to defend structures.

**Fort Count**:
How many forts a Governor participated in destroying in a Fort Week, whether it started the attack or joined another Governor's.

**Fort Week**:
The seven days from one Monday 00:00 UTC reset to the next, over which Fort Counts build up.

**Live Week**:
The Fort Week in progress now.

**Complete Week**:
A closed Fort Week whose last reading came close enough to the Monday reset to be treated as final.

**Partial Week**:
A closed Fort Week with no reading on the evening of its last day, so a missing Governor's Fort Count is unknown.

**Group Score**:
A Main's own Fort Count plus its Farms' Fort Counts, each multiplied by a Farm Weight Coefficient.

**Farm Weight Coefficient**:
The configurable coefficient for how much a Farm's Fort Count weighs in its Main's Group Score. It can depend on how many Farms the Main has.
_Avoid_: Farm Coefficient

**Fort Pause**:
A span the Council sets when there are no Fort Rankings, usually during a KvK. Weeks inside it are not Fort Weeks at all, so they never count as missed.
_Avoid_: off-season, Forts off

**Weekly Ranking**:
The order of Mains in a Fort Week, either by their own Fort Counts or by Group Score. Tied Mains share a rank.

**Fort Average**:
A Governor's average Fort Count from their first ranked Fort Week onward. A missed Complete Week counts as 0, while a missed Partial Week and the Live Week are left out.

**Weekly Award**:
What the Council gives for a closed Fort Week.

**GH Event**:
An event whose reward is Golden Heads, the game's most valuable resource. Kingdoms usually fix its top 10 beforehand, deciding who gets each place.

**Roster Snapshot**:
One day's stats for a Kingdom's Governors, as published by Lilith: each Governor's power at the end of that day, and what they gained during it (kills, deaths, resources gathered, helps).

**Main Alliance**:
The strongest alliance in a Kingdom, where its strongest Governors gather. Alliance names change, so it is never identified by name.

## KvK

**KvK**:
A war of about two months, a few times a year, in which Kingdom 3493 fights on one side of several allied Kingdoms against the other side.
_Avoid_: Kingdom versus Kingdom (it is never one Kingdom against one)

**KvK Start Snapshot**:
The Roster Snapshot the Council picks as the starting state of each Governor for a KvK.
_Avoid_: Baseline

**Counting Period**:
A span of whole days inside a KvK when kills and deaths count, because the war is being fought for objectives. A KvK can have several; kills outside them, such as fights during preparation, are ignored.

**Power Cutoff**:
The power, set by the Council for each KvK, at or above which a Governor in the KvK Start Snapshot counts as taking part. It stands in for City Hall 25, which no data source records.

**DKP**:
A Governor's main KvK score: their T4 and T5 kills and T4 and T5 deaths over the Counting Periods, each multiplied by a weight the Council sets for that KvK.
_Avoid_: KvK score, kill score
