-- Private bucket for clips uploaded to the AI clip analyser (/analysis).
-- Uploads go straight from the browser via a signed upload URL issued by
-- /api/analysis/upload-url; the server deletes each clip once Gemini has it.
-- 50 MB matches the Supabase free-tier per-file cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', false, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;
