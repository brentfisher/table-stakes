import { HarnessShell } from './harness-shell';
import { harnesses } from './harnesses';
import './styles.css';

const root = document.getElementById('harness-root');
if (!root) throw new Error('#harness-root not found');

const shell = new HarnessShell(root, harnesses);
shell.start();
