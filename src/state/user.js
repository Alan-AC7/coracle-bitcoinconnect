import {writable} from "svelte/store"
import {getLocalJson, setLocalJson} from "src/util/misc"
import {nostr} from 'src/state/nostr'

export const user = writable(getLocalJson("coracle/user"))

user.subscribe($user => {
  setLocalJson("coracle/user", $user)

  // Keep nostr in sync
  nostr.login($user?.privkey)

  // Migrate data from old formats
  if (!$user.petnames || !$user.muffle) {
    user.set({...$user, petnames: [], muffle: []})
  }
})

