import { ImportPaused } from "./video-reader.mjs";

export async function runImportQueue(
  files,
  { processFile, paused, onStatus, onProgress },
) {
  const failed = [];
  let completed = 0;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (paused())
      return { completed, failed, paused: true, remaining: files.slice(index) };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await processFile(file, index, attempt);
        completed++;
        break;
      } catch (error) {
        if (
          error instanceof ImportPaused ||
          error.name === "ImportPaused" ||
          paused()
        )
          return {
            completed,
            failed,
            paused: true,
            remaining: files.slice(index),
          };
        if (error.status === 401 || error.status === 403 || error.fatal)
          throw error;
        if (error.retryable && attempt === 0) {
          onStatus(
            `${file.name} · decoding stalled, reopening the clip and resuming saved frames…`,
          );
          continue;
        }
        failed.push({ file, message: error.message });
        onStatus(
          `${file.name} · skipped for now. Continuing with the other clips.`,
        );
        break;
      }
    }
    onProgress((index + 1) / files.length);
  }
  return { completed, failed, paused: false, remaining: [] };
}
