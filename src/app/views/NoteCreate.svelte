<script lang="ts">
  import {onMount} from "svelte"
  import {nip19} from "nostr-tools"
  import {v4 as uuid} from "uuid"
  import {join, whereEq, identity, prop, uniqBy} from "ramda"
  import {throttle, commaFormat, toTitle, switcherFn} from "hurdak"
  import {createEvent, now, Tags} from "paravel"
  import {asNostrEvent} from "src/util/nostr"
  import {currencyOptions} from "src/util/i18n"
  import {dateToSeconds} from "src/util/misc"
  import {toast} from "src/partials/state"
  import Anchor from "src/partials/Anchor.svelte"
  import Compose from "src/app/shared/Compose.svelte"
  import ImageInput from "src/partials/ImageInput.svelte"
  import CurrencyInput from "src/partials/CurrencyInput.svelte"
  import CurrencySymbol from "src/partials/CurrencySymbol.svelte"
  import DateTimeInput from "src/partials/DateTimeInput.svelte"
  import Field from "src/partials/Field.svelte"
  import Input from "src/partials/Input.svelte"
  import Content from "src/partials/Content.svelte"
  import Popover from "src/partials/Popover.svelte"
  import Menu from "src/partials/Menu.svelte"
  import MenuItem from "src/partials/MenuItem.svelte"
  import Chip from "src/partials/Chip.svelte"
  import NoteContent from "src/app/shared/NoteContent.svelte"
  import NoteOptions from "src/app/shared/NoteOptions.svelte"
  import NoteImages from "src/app/shared/NoteImages.svelte"
  import {Publisher, mention} from "src/engine"
  import {toastProgress} from "src/app/state"
  import {router} from "src/app/router"
  import {
    groups,
    session,
    getEventHints,
    getUserRelayUrls,
    publishToZeroOrMoreGroups,
    deriveMembershipLevel,
  } from "src/engine"

  export let type = "note"
  export let quote = null
  export let pubkey = null
  export let group = null
  export let initialValues = {}

  let images, compose
  let charCount = 0
  let wordCount = 0
  let showPreview = false
  let defaultGroups = quote ? Tags.from(quote).communities().all() : [group].filter(identity)
  let options
  let opts = {
    title: "",
    warning: "",
    summary: "",
    price: "",
    currency: currencyOptions.find(whereEq({code: "SAT"})),
    groups: defaultGroups,
    relays: getUserRelayUrls("write"),
    shouldWrap: true,
    anonymous: false,
    location: null,
    start: null,
    end: null,
    ...initialValues,
  }

  const setOpts = e => {
    opts = {...opts, ...e.detail}
  }

  const groupOptions = session.derived($session => {
    const options = []

    for (const address of Object.keys($session.groups || {})) {
      const group = groups.key(address).get()

      if (group && deriveMembershipLevel(address).get()) {
        options.push(group)
      }
    }

    for (const address of defaultGroups) {
      options.push({address})
    }

    return uniqBy(prop("address"), options)
  })

  const onSubmit = async () => {
    const tags = []
    const content = compose.parse().trim()

    if (!content) return toast.show("error", "Please provide a description.")

    if (type === "calendar_event") {
      if (!opts.title) {
        return toast.show("error", "Please name your event.")
      }

      if (!opts.start || !opts.end) {
        return toast.show("error", "Please provide a start and end date and time.")
      }
    }

    if (type === "listing") {
      if (!opts.title) {
        return toast.show("error", "Please name your listing.")
      }

      if (isNaN(parseFloat(opts.price))) {
        return toast.show("error", "Please provide a valid price.")
      }

      if (!opts.currency) {
        return toast.show("error", "Please select a currency.")
      }
    }

    for (const imeta of images.getValue()) {
      if (type === "listing") {
        tags.push(["image", imeta.type("url").values().first()])
      } else {
        tags.push(["imeta", ...imeta.all().map(join(" "))])
      }
    }

    if (opts.warning) {
      tags.push(["content-warning", opts.warning])
    }

    if (quote) {
      tags.push(mention(quote.pubkey))

      // Re-broadcast the note we're quoting
      if (!opts.groups.length) {
        Publisher.publish({
          relays: opts.relays,
          event: asNostrEvent(quote),
        })
      }
    }

    const template = switcherFn(type, {
      note: () => createEvent(1, {content, tags}),
      listing: () =>
        createEvent(30402, {
          content,
          tags: [
            ...tags,
            ["d", uuid()],
            ["title", opts.title],
            ["summary", opts.summary || ""],
            ["location", opts.location || ""],
            ["published_at", now().toString()],
            ["price", opts.price, opts.currency.code],
          ],
        }),
      calendar_event: () =>
        createEvent(31923, {
          content,
          tags: [
            ...tags,
            ["d", uuid()],
            ["name", opts.title],
            ["start", dateToSeconds(opts.start).toString()],
            ["end", dateToSeconds(opts.end).toString()],
            ["location", opts.location || ""],
          ],
        }),
    })

    const pubs = await publishToZeroOrMoreGroups(opts.groups, template, opts)

    pubs[0].on("progress", toastProgress)

    router.clearModals()
  }

  const togglePreview = () => {
    showPreview = !showPreview
  }

  const updateCounts = throttle(300, () => {
    if (compose) {
      const content = compose.parse()

      charCount = content.length || 0
      wordCount = content.trim() ? (content.match(/\s+/g)?.length || 0) + 1 : 0
    }
  })

  const setType = t => {
    type = t
  }

  onMount(() => {
    if (pubkey && pubkey !== $session.pubkey) {
      compose.mention(pubkey)
    }

    if (quote) {
      const nevent = nip19.neventEncode({id: quote.id, relays: getEventHints(quote)})

      compose.nevent("nostr:" + nevent)
    }
  })
</script>

<form on:submit|preventDefault={onSubmit}>
  <Content size="lg">
    <div class="flex gap-2">
      <span class="text-2xl font-bold">Create a</span>
      <Popover theme="transparent" placement="bottom" opts={{hideOnClick: true}}>
        <div slot="trigger">
          <Chip class="cursor-pointer">{toTitle(type)} <i class="fa fa-caret-down" /></Chip>
        </div>
        <div slot="tooltip">
          <Menu class="-mt-2 w-24">
            <MenuItem on:click={() => setType("note")}>Note</MenuItem>
            <MenuItem on:click={() => setType("calendar_event")}>Event</MenuItem>
            <MenuItem on:click={() => setType("listing")}>Listing</MenuItem>
          </Menu>
        </div>
      </Popover>
    </div>
    <div class="flex w-full flex-col gap-4">
      {#if type !== "note"}
        <Field label="Title">
          <Input bind:value={opts.title} />
        </Field>
      {/if}
      {#if type === "listing"}
        <Field label="Summary">
          <Input bind:value={opts.summary} />
        </Field>
        <Field label="Price">
          <div class="grid grid-cols-3 gap-2">
            <div class="col-span-2">
              <Input type="number" placeholder="0" bind:value={opts.price}>
                <span slot="before">
                  <CurrencySymbol code={opts.currency?.code || "USD"} />
                </span>
              </Input>
            </div>
            <div class="relative">
              <CurrencyInput bind:value={opts.currency} />
            </div>
          </div>
        </Field>
      {/if}
      {#if type === "calendar_event"}
        <div class="grid grid-cols-2 gap-2">
          <div class="flex flex-col gap-1">
            <strong>Start</strong>
            <DateTimeInput bind:value={opts.start} />
          </div>
          <div class="flex flex-col gap-1">
            <strong>End</strong>
            <DateTimeInput bind:value={opts.end} />
          </div>
        </div>
      {/if}
      {#if type !== "note"}
        <Field label="Location (optional)">
          <Input bind:value={opts.location} />
        </Field>
      {/if}
      <Field label={type === "note" ? "What do you want to say?" : "Description"}>
        <div
          class="rounded-xl border border-solid border-gray-6 p-3"
          class:bg-input={!showPreview}
          class:text-black={!showPreview}
          class:bg-gray-7={showPreview}>
          {#if showPreview}
            <NoteContent note={{content: compose.parse(), tags: []}} />
          {/if}
          <div class:hidden={showPreview}>
            <Compose on:keyup={updateCounts} bind:this={compose} {onSubmit} />
          </div>
        </div>
        <div class="flex items-center justify-end gap-2 text-gray-5">
          <small class="hidden sm:block">
            {commaFormat(charCount)} characters
          </small>
          <span>•</span>
          <small class="hidden sm:block">
            {commaFormat(wordCount)} words
          </small>
          <span>•</span>
          <small on:click={togglePreview} class="cursor-pointer underline">
            {showPreview ? "Hide" : "Show"} Preview
          </small>
        </div>
      </Field>
      <NoteImages bind:this={images} bind:compose includeInContent={type !== 'listing'} />
      <div class="flex gap-2">
        <Anchor tag="button" theme="button" type="submit" class="flex-grow text-center"
          >Send</Anchor>
        <ImageInput multi hostLimit={3} on:change={e => images.addImage(e.detail)} />
      </div>
      <small
        class="flex cursor-pointer items-center justify-end gap-4"
        on:click={() => options.setView("settings")}>
        <span><i class="fa fa-circle-nodes" /> {opts.groups.length}</span>
        <span><i class="fa fa-server" /> {opts.relays?.length}</span>
        <span><i class="fa fa-warning" /> {opts.warning || 0}</span>
      </small>
    </div>
  </Content>
</form>

<NoteOptions
  on:change={setOpts}
  bind:this={options}
  initialValues={opts}
  groupOptions={$groupOptions} />
