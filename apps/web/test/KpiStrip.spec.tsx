import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { KpiStrip } from '../src/components/KpiStrip';

describe('apps/web: KpiStrip Component Suite', () => {
  it('renders all 4 financial KPI cards with exact counts and amounts', () => {
    render(<KpiStrip />);

    expect(screen.getByText('Needs review')).toBeDefined();
    expect(screen.getByText('Awaiting approval')).toBeDefined();
    expect(screen.getByText('Auto-executed')).toBeDefined();
    expect(screen.getByText('Blocked by policy')).toBeDefined();

    expect(screen.getAllByText('2 bills · $1,284.50')).toHaveLength(2);
    expect(screen.getByText('8 bills')).toBeDefined();
    expect(screen.getByText('2 bills')).toBeDefined();
  });
});
