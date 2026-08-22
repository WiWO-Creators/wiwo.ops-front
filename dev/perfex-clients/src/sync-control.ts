import { ALL_STAGES, type Stage } from './import'

export type ControlStage = 'preflight' | Stage | 'owners' | 'permisos' | 'archivar'

export interface ControlStageDescriptor {
  id: ControlStage
  label: string
  tables: string[]
}

/** Etapas visibles del centro de migración, en el único orden seguro para una corrida completa. */
export const CONTROL_STAGES: ControlStageDescriptor[] = [
  {
    id: 'preflight',
    label: 'Preflight',
    tables: [
      'tblclients',
      'tblcustomer_groups',
      'tblcustomers_groups',
      'tblcustomfieldsvalues',
      'tblcustomfields',
      'tblcontacts',
      'tblprojects',
      'tbltasks',
      'tbltask_assigned'
    ]
  },
  { id: 'personas', label: 'Personas', tables: ['tblstaff'] },
  {
    id: 'clientes',
    label: 'Clientes y contactos',
    tables: [
      'tblclients',
      'tblcustomer_groups',
      'tblcustomers_groups',
      'tblcustomfieldsvalues',
      'tblcustomfields',
      'tblcontacts'
    ]
  },
  {
    id: 'proyectos',
    label: 'Proyectos, tareas y comentarios',
    tables: [
      'tblclients',
      'tblcustomer_groups',
      'tblcustomers_groups',
      'tblcontacts',
      'tblstaff',
      'tblprojects',
      'tblcustomfieldsvalues',
      'tblcustomfields',
      'tbltasks',
      'tbltask_assigned',
      'tbltask_comments'
    ]
  },
  { id: 'hitos', label: 'Hitos', tables: ['tblmilestones', 'tbltasks', 'tbltask_assigned', 'tblcustomfieldsvalues'] },
  { id: 'checklists', label: 'Checklists', tables: ['tblstaff', 'tbltask_checklist_items'] },
  { id: 'tiempo', label: 'Registro de tiempo', tables: ['tblstaff', 'tbltaskstimers'] },
  { id: 'etiquetas', label: 'Etiquetas', tables: ['tbltags', 'tbltaggables', 'tblprojects', 'tbltasks'] },
  {
    id: 'adjuntos',
    label: 'Adjuntos',
    tables: [
      'tblclients',
      'tblcustomer_groups',
      'tblcustomers_groups',
      'tblcustomfieldsvalues',
      'tblcustomfields',
      'tblcontacts',
      'tblfiles',
      'tblcontracts'
    ]
  },
  {
    id: 'colaboradores',
    label: 'Colaboradores',
    tables: ['tbltask_followers', 'tbltask_assigned', 'tblstaff', 'tbltasks']
  },
  { id: 'owners', label: 'Owners', tables: [] },
  {
    id: 'permisos',
    label: 'Permisos',
    tables: [
      'tblprojects',
      'tblcustomfieldsvalues',
      'tblclients',
      'tblcustomer_groups',
      'tblcustomers_groups',
      'tblcustomfields',
      'tblcontacts',
      'tblcustomer_admins',
      'tblstaff'
    ]
  },
  {
    id: 'archivar',
    label: 'Archivar ausentes',
    tables: [
      'tblclients',
      'tblcustomer_groups',
      'tblcustomers_groups',
      'tblcustomfieldsvalues',
      'tblcustomfields',
      'tblcontacts',
      'tblprojects',
      'tbltasks',
      'tbltask_assigned'
    ]
  }
]

const controlStageIds = new Set<ControlStage>(CONTROL_STAGES.map(({ id }) => id))

/** Valida etapas recibidas desde CLI o API antes de ejecutarlas. */
export function isControlStage (value: string): value is ControlStage {
  return controlStageIds.has(value as ControlStage)
}

/** Distingue etapas delegables al importador histórico. */
export function isImportStage (value: ControlStage): value is Stage {
  return ALL_STAGES.includes(value as Stage)
}
