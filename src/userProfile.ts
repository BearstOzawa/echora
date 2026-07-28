export type UserProfile = {
  id: string
  displayName: string
  createdAt: number
}

export const userProfileStorageKey = 'echora.userProfile'

export const defaultUserProfile = (): UserProfile => ({
  id: `local-${Date.now().toString(36)}`,
  displayName: '访客',
  createdAt: Date.now(),
})

export const readUserProfile = (storage: Pick<Storage, 'getItem'> = localStorage): UserProfile => {
  try {
    const stored = JSON.parse(storage.getItem(userProfileStorageKey) ?? 'null') as Partial<UserProfile> | null
    if (!stored || typeof stored.id !== 'string' || typeof stored.displayName !== 'string' || !stored.displayName.trim() || typeof stored.createdAt !== 'number') return defaultUserProfile()
    return { id: stored.id, displayName: stored.displayName.trim().slice(0, 24), createdAt: stored.createdAt }
  } catch {
    return defaultUserProfile()
  }
}

export const writeUserProfile = (profile: UserProfile, storage: Pick<Storage, 'setItem'> = localStorage) => storage.setItem(userProfileStorageKey, JSON.stringify(profile))
