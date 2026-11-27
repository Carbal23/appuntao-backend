import { loadTestEnv } from './test-env';

// Cada archivo de pruebas corre en su propio entorno de Jest: aquí se fijan
// las variables antes de importar la aplicación.
loadTestEnv();
