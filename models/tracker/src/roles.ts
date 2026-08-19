//
// Roles de un proyecto del tracker.
//
// El focal es el dueño del proyecto: crea, edita y borra tareas y administra el proyecto. El equipo
// trabaja las tareas y las ve todas. El restringido trabaja igual que el equipo, pero sólo ve las
// tareas donde es responsable o creador; ese recorte no es un permiso, lo aplica el filtrado por
// colaborador del servidor.
//
// Los permisos sólo se hacen valer si el proyecto tiene `restricted: true`; sin eso el servidor
// deja pasar cualquier escritura de un miembro.
//
import core, { type Permission, type Ref, type Role } from '@hcengineering/core'

import tracker from './plugin'

/** Permisos que un rol puede tener sobre un proyecto, para el editor de tipos de proyecto. */
export const projectPermissions: Ref<Permission>[] = [
  tracker.permission.CreateIssue,
  tracker.permission.UpdateIssue,
  tracker.permission.DeleteIssue,
  core.permission.UpdateSpace,
  core.permission.ArchiveSpace
]

export const roles: Pick<Role, '_id' | 'name' | 'permissions' | 'collaboratorsOnly'>[] = [
  {
    _id: tracker.role.Focal,
    name: 'Focal',
    permissions: [...projectPermissions]
  },
  {
    _id: tracker.role.Equipo,
    name: 'Equipo',
    permissions: [tracker.permission.CreateIssue, tracker.permission.UpdateIssue]
  },
  {
    _id: tracker.role.Restringido,
    name: 'Restringido',
    permissions: [tracker.permission.CreateIssue, tracker.permission.UpdateIssue],
    collaboratorsOnly: true
  }
]
