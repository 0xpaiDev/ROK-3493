-- Reward payout, ticket 01, second half: drops the free-text place and the three-argument set_reward_promise.
-- Apply only once the site that reads first_place, last_place and label is live on Pages; until then the old
-- site still selects place and the old admin page still calls the three-argument function.
-- Safe to run twice.

alter table reward_promise_tier drop column if exists place;
drop function if exists public.set_reward_promise(date, text, jsonb);
