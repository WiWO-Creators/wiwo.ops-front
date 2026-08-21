<script lang="ts">
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { Analytics } from '@hcengineering/analytics'
  import { type ActiveTaskTimer, type Issue } from '@hcengineering/tracker'
  import { Button } from '@hcengineering/ui'
  import { createQuery, getClient } from '@hcengineering/presentation'

  import tracker from '../../../plugin'

  export let issue: Issue
  export let readonly = false

  const client = getClient()
  const employee = getCurrentEmployee()
  const query = createQuery()
  let timer: ActiveTaskTimer | undefined
  let isSaving = false

  $: query.query(
    tracker.class.ActiveTaskTimer,
    { attachedTo: issue._id, employee },
    (result) => {
      ;[timer] = result
    },
    { limit: 1 }
  )

  /** Starts or finalizes the current employee's timer for this issue. */
  async function toggleTimer (): Promise<void> {
    if (employee === undefined || readonly || isSaving) return

    isSaving = true
    try {
      if (timer === undefined) {
        const existing = await client.findOne(tracker.class.ActiveTaskTimer, { employee })
        if (existing !== undefined) return

        await client.addCollection(tracker.class.ActiveTaskTimer, issue.space, issue._id, issue._class, 'activeTimers', {
          employee,
          startedOn: Date.now()
        })
        return
      }

      await client.addCollection(tracker.class.TimeSpendReport, issue.space, issue._id, issue._class, 'reports', {
        employee,
        date: timer.startedOn,
        value: Math.max((Date.now() - timer.startedOn) / 3_600_000, 1 / 60),
        description: ''
      })
      await client.remove(timer)
    } catch (err: any) {
      Analytics.handleError(err)
    } finally {
      isSaving = false
    }
  }
</script>

<Button
  icon={timer === undefined ? tracker.icon.Start : tracker.icon.Stop}
  iconProps={{ size: 'small' }}
  kind={'regular'}
  size={'small'}
  disabled={readonly || employee === undefined || isSaving}
  showTooltip={{ label: timer === undefined ? 'Iniciar timer' : 'Detener timer' }}
  on:click={toggleTimer}
>
  <span slot="content">{timer === undefined ? 'Iniciar' : 'Detener'}</span>
</Button>
