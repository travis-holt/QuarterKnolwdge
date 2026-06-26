// Global test setup — extends Vitest's expect with @testing-library/jest-dom matchers
// so component tests can use .toBeInTheDocument(), .toHaveTextContent(), etc.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
