// Keep the recovered renderer isolated from the current main stylesheet.
// The rich-module stylesheet is imported into a low-priority cascade layer so
// current unlayered design-system rules remain authoritative.
import '../styles-training.css';

export { default } from './TrainingModuleRich.jsx';
