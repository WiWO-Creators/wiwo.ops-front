import type { Builder } from '@hcengineering/model'
import core from '@hcengineering/core'
import tracker from '@hcengineering/tracker'

export function definePermissions (builder: Builder): void {
  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: tracker.string.ForbidCreateProjectPermission,
      txClass: core.class.TxCreateDoc,
      objectClass: tracker.class.Project,
      forbid: true,
      scope: 'workspace',
      description: tracker.string.ForbidCreateProjectPermissionDescription
    },
    tracker.permission.ForbidCreateProject
  )

  // Permisos de tarea, necesarios para que un proyecto con `restricted` pueda negar por defecto:
  // el middleware sólo sabe prohibir una escritura si hay un permiso declarado para esa clase.
  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: tracker.string.CreateIssuePermission,
      txClass: core.class.TxCreateDoc,
      objectClass: tracker.class.Issue,
      scope: 'space',
      description: tracker.string.CreateIssuePermissionDescription
    },
    tracker.permission.CreateIssue
  )

  // TxUpdateDoc cubre también los TxMixin sobre la tarea (ver isTxClassMatched en spacePermissions).
  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: tracker.string.UpdateIssuePermission,
      txClass: core.class.TxUpdateDoc,
      objectClass: tracker.class.Issue,
      scope: 'space',
      description: tracker.string.UpdateIssuePermissionDescription
    },
    tracker.permission.UpdateIssue
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: tracker.string.DeleteIssuePermission,
      txClass: core.class.TxRemoveDoc,
      objectClass: tracker.class.Issue,
      scope: 'space',
      description: tracker.string.DeleteIssuePermissionDescription
    },
    tracker.permission.DeleteIssue
  )
}
