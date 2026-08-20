//
// Copyright © 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

const fs = require('fs')
const path = require('path')

// La version del modelo vive en version.txt. Antes solo se leia si
// `git describe --tags` tenia exito: el clon del servidor viene del fork, que no
// publica tags, asi que fallaba y las imagenes se compilaban como 0.6.0. Con un
// modelo por debajo del que quedo guardado en el workspace, el transactor
// rechaza a todos los clientes ("Preparando el espacio de trabajo...") y el
// servicio workspace tampoco lo arregla: solo migra hacia arriba.
function main() {
  try {
    const versionFilePath = path.resolve(__dirname, 'version.txt')
    console.log(fs.readFileSync(versionFilePath, 'utf8').trim())
  } catch (error) {
    console.log('"0.6.0"')
  }
}

main()
