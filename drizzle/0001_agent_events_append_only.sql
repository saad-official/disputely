-- agent_events is an append-only audit trail (hand-written migration).
-- UPDATE is always rejected. DELETE is rejected unless the parent organization
-- is already gone, i.e. the delete is the ON DELETE CASCADE from deleting the
-- whole organization (account deletion). TRUNCATE is always rejected.
-- This applies to every role, including the table owner.
CREATE OR REPLACE FUNCTION "disputely"."agent_events_append_only"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF tg_op = 'DELETE'
     AND old.org_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "disputely"."organizations" o WHERE o.id = old.org_id) THEN
    RETURN old;
  END IF;
  RAISE EXCEPTION 'agent_events is append-only (% rejected)', tg_op
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "agent_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "disputely"."agent_events"
  FOR EACH ROW EXECUTE FUNCTION "disputely"."agent_events_append_only"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "disputely"."agent_events_no_truncate"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'agent_events is append-only (TRUNCATE rejected)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "agent_events_no_truncate"
  BEFORE TRUNCATE ON "disputely"."agent_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "disputely"."agent_events_no_truncate"();
