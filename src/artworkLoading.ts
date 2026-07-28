const maximumConcurrentArtworkLoads = 6

type ArtworkLoadJob = {
  token: symbol
  start: () => void
}

const activeJobs = new Set<symbol>()
const pendingJobs: ArtworkLoadJob[] = []

const drainArtworkQueue = () => {
  while (activeJobs.size < maximumConcurrentArtworkLoads && pendingJobs.length) {
    const job = pendingJobs.shift()!
    activeJobs.add(job.token)
    job.start()
  }
}

export const scheduleArtworkLoad = (start: () => void) => {
  const token = Symbol('artwork-load')
  pendingJobs.push({ token, start })
  drainArtworkQueue()
  return token
}

export const finishArtworkLoad = (token: symbol | null) => {
  if (!token) return
  const pendingIndex = pendingJobs.findIndex((job) => job.token === token)
  if (pendingIndex >= 0) pendingJobs.splice(pendingIndex, 1)
  activeJobs.delete(token)
  drainArtworkQueue()
}

export const artworkLoadQueueSnapshot = () => ({
  active: activeJobs.size,
  pending: pendingJobs.length,
  limit: maximumConcurrentArtworkLoads,
})
