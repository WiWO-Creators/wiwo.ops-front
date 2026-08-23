<script lang="ts">
  import type { Floor as FloorDoc, Room } from '@hcengineering/love'
  import { RoomAccess, RoomType } from '@hcengineering/love'
  import love from '../plugin'
  import AddRoomPopup from './AddRoomPopup.svelte'
  import EditRoom from './EditRoom.svelte'
  import Floor from './Floor.svelte'

  export let demo: string

  const tutorialFloor = {
    _id: 'guided-tour-floor',
    _class: love.class.Floor,
    name: 'Oficina principal'
  } as unknown as FloorDoc

  const tutorialRoom = {
    _id: 'guided-tour-room',
    _class: love.class.Room,
    name: 'Sala de equipo',
    floor: tutorialFloor._id,
    type: RoomType.Video,
    access: RoomAccess.Open,
    width: 2,
    height: 1,
    x: 0,
    y: 0,
    language: 'es',
    startWithTranscription: false,
    startWithRecording: false,
    description: null
  } as unknown as Room
</script>

<div class="guided-tour-love-demo">
  {#if demo === 'telework-detail'}
    <EditRoom object={tutorialRoom} />
  {:else if demo === 'telework-room-types'}
    <AddRoomPopup floor={tutorialFloor._id} />
  {:else}
    <Floor floor={tutorialFloor._id} rooms={[tutorialRoom]} {tutorialFloor} />
  {/if}
</div>

<style lang="scss">
  .guided-tour-love-demo {
    min-width: min(52rem, calc(100vw - 4rem));
    min-height: 10rem;
  }
</style>
