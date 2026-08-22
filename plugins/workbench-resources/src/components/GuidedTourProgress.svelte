<script lang="ts">
  import contact, { type Employee } from '@hcengineering/contact'
  import type { Class, Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { closePopup, Label, Scroller } from '@hcengineering/ui'
  import workbenchModel from '@hcengineering/workbench'
  import type { GuidedTourPreference } from '@hcengineering/workbench/src/types'
  import workbench from '../plugin'

  let employees: Employee[] = []
  let preferences: GuidedTourPreference[] = []
  const employeesQuery = createQuery()
  const preferencesQuery = createQuery()
  const guidedTourPreferenceClass = (workbenchModel.class as typeof workbenchModel.class & {
    GuidedTourPreference: Ref<Class<GuidedTourPreference>>
  }).GuidedTourPreference

  employeesQuery.query(contact.mixin.Employee, { active: true }, (records) => {
    employees = records
  })
  preferencesQuery.query(guidedTourPreferenceClass, {}, (records) => {
    preferences = records
  })

  $: trackedEmployees = employees.filter((employee) => employee.personUuid !== undefined)
  $: completedAccounts = new Set(preferences.filter((preference) => preference.completedOn !== undefined).map((preference) => preference.attachedTo))
  $: skippedAccounts = new Set(preferences.filter((preference) => preference.skippedOn !== undefined && !completedAccounts.has(preference.attachedTo)).map((preference) => preference.attachedTo))
  $: completedEmployees = trackedEmployees.filter((employee) => completedAccounts.has(employee.personUuid))
  $: skippedEmployees = trackedEmployees.filter((employee) => skippedAccounts.has(employee.personUuid))
  $: pendingEmployees = trackedEmployees.filter((employee) => !completedAccounts.has(employee.personUuid) && !skippedAccounts.has(employee.personUuid))
</script>

<div class="guided-tour-progress" role="dialog" aria-labelledby="guided-tour-progress-title">
  <div class="guided-tour-progress-header">
    <div>
      <h2 id="guided-tour-progress-title"><Label label={workbench.string.GuidedTourProgress} /></h2>
      <p><Label label={workbench.string.GuidedTourProgressDescription} /></p>
    </div>
    <button type="button" on:click={() => closePopup()}>Cerrar</button>
  </div>
  <div class="guided-tour-summary">
    <span><strong>{completedEmployees.length}</strong> <Label label={workbench.string.GuidedTourCompleted} /></span>
    <span><strong>{skippedEmployees.length}</strong> <Label label={workbench.string.GuidedTourSkipped} /></span>
    <span><strong>{pendingEmployees.length}</strong> <Label label={workbench.string.GuidedTourPending} /></span>
  </div>
  <Scroller padding={'0 0.25rem'}>
    <div class="guided-tour-columns">
      <section>
        <h3><Label label={workbench.string.GuidedTourCompleted} /></h3>
        {#each completedEmployees as employee}<div>{employee.name}</div>{:else}<p><Label label={workbench.string.GuidedTourNone} /></p>{/each}
      </section>
      <section>
        <h3><Label label={workbench.string.GuidedTourSkipped} /></h3>
        {#each skippedEmployees as employee}<div>{employee.name}</div>{:else}<p><Label label={workbench.string.GuidedTourNone} /></p>{/each}
      </section>
      <section>
        <h3><Label label={workbench.string.GuidedTourPending} /></h3>
        {#each pendingEmployees as employee}<div>{employee.name}</div>{:else}<p><Label label={workbench.string.GuidedTourNone} /></p>{/each}
      </section>
    </div>
  </Scroller>
</div>

<style lang="scss">
  .guided-tour-progress { display: flex; flex-direction: column; width: min(42rem, calc(100vw - 2rem)); max-height: min(32rem, calc(100vh - 2rem)); padding: 1.25rem; background: var(--theme-popup-color); border-radius: 0.75rem; }
  .guided-tour-progress-header, .guided-tour-summary, .guided-tour-columns { display: flex; gap: 1rem; }
  .guided-tour-progress-header { justify-content: space-between; }
  h2, h3, p { margin: 0; }
  h2 { font-size: 1.125rem; }
  .guided-tour-progress-header p, p { color: var(--theme-dark-color); }
  .guided-tour-summary { margin: 1.25rem 0; }
  .guided-tour-columns section { flex: 1; min-width: 0; }
  .guided-tour-columns h3 { margin-bottom: 0.5rem; }
  .guided-tour-columns section > div { padding: 0.375rem 0; border-bottom: 1px solid var(--divider-color); }
  button { align-self: start; padding: 0.375rem 0.75rem; color: var(--theme-content-color); background: transparent; border: 1px solid var(--theme-button-border); border-radius: 0.375rem; cursor: pointer; }
  @media (max-width: 480px) { .guided-tour-columns { flex-direction: column; } }
</style>
