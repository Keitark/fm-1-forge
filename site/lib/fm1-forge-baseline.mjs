// A browser preference or successful relay delivery cannot unlock the starter.
// Only the exact terminal switch job and protected write receipts may do so.
export function diagnosticProof(task, job, expectedDigest) {
  if (!task || !job || !/^[a-f0-9]{64}$/.test(expectedDigest || '')) return null;
  const args = JSON.parse(task.arguments);
  const expectedId = task.operation === 'switch_app' ? task.id : task.operation === 'job' ? args.job_id : null;
  const result = job.result, data = result?.data, progress = job.progress;
  if (!expectedId || job.id !== expectedId || job.operation !== 'switch_app' || job.status !== 'succeeded' || result?.ok !== true ||
      data?.catalog_id !== 'factory-diag' || data.sha256 !== expectedDigest || data.profile !== 'FM1-FORGE/1' ||
      data.written_readback_verified !== true || data.serial_boot_verified !== true ||
      progress?.phase !== 'completed' || progress.failed !== false || progress.write_complete !== true ||
      progress.full_readback_verified !== true || progress.boot_verified !== true ||
      !Number.isInteger(progress.total_sectors) || progress.total_sectors < 1 || progress.total_sectors > 143 ||
      progress.verified_sectors !== progress.total_sectors) return null;
  if (task.operation === 'switch_app' && (args.catalog_id !== 'factory-diag' || args.expected_sha256 !== expectedDigest)) return null;
  const verifiedAt = Date.parse(job.updated);
  if (!Number.isFinite(verifiedAt) || verifiedAt > Date.now() + 60000) return null;
  return {catalog_id:'factory-diag',job_id:job.id,sha256:expectedDigest,verified_at:Math.floor(verifiedAt / 1000),
    write_verified:true,full_readback_verified:true,boot_verified:true};
}
