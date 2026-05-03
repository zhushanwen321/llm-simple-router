-- backend_services → providers
-- model_mappings.backend_service_id → provider_id
-- request_logs.backend_service_id → provider_id

ALTER TABLE backend_services RENAME TO providers;

ALTER TABLE model_mappings RENAME COLUMN backend_service_id TO provider_id;

ALTER TABLE request_logs RENAME COLUMN backend_service_id TO provider_id;
