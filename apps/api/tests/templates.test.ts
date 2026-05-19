import { describe, expect, it } from 'vitest';
import { templateFor } from '@opencoder/shared';

describe('templates', () => {
  it('hello for python', () => {
    expect(templateFor('python312', 'hello')).toContain('hello, friend');
  });
  it('leetcode for python', () => {
    expect(templateFor('python312', 'leetcode')).toContain('two_sum');
  });
  it('leetcode for go', () => {
    expect(templateFor('go122', 'leetcode')).toContain('twoSum');
  });
  it('falls back for langs without leetcode body', () => {
    expect(templateFor('lua', 'leetcode')).toContain('leetcode');
  });
  it('aliases resolve through groups', () => {
    expect(templateFor('python', 'hello')).toContain('hello, friend');
    expect(templateFor('cpp', 'hello')).toContain('std::cout');
  });
});
