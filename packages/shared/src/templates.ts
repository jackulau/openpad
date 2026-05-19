import { resolveLanguage } from './languages.js';

export type TemplateKind = 'hello' | 'leetcode';

const HELLO: Record<string, string> = {
  python: 'print("hello, friend!")\n',
  javascript: 'console.log("hello, friend!");\n',
  typescript: 'const greet = (who: string) => `hello, ${who}!`;\nconsole.log(greet("friend"));\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello, friend!")\n}\n',
  rust: 'fn main() {\n    println!("hello, friend!");\n}\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("hello, friend!");\n    }\n}\n',
  cpp: '#include <iostream>\nint main() {\n    std::cout << "hello, friend!\\n";\n}\n',
  c: '#include <stdio.h>\nint main() {\n    printf("hello, friend!\\n");\n    return 0;\n}\n',
  ruby: 'puts "hello, friend!"\n',
  csharp: 'Console.WriteLine("hello, friend!");\n',
  kotlin: 'fun main() {\n    println("hello, friend!")\n}\n',
  swift: 'print("hello, friend!")\n',
  php: '<?php\necho "hello, friend!\\n";\n',
  bash: '#!/usr/bin/env bash\necho "hello, friend!"\n',
  lua: 'print("hello, friend!")\n',
  elixir: 'IO.puts("hello, friend!")\n',
  haskell: 'main :: IO ()\nmain = putStrLn "hello, friend!"\n',
  scala: '@main def hello() = println("hello, friend!")\n',
  perl: 'print "hello, friend!\\n";\n',
  r: 'cat("hello, friend!\\n")\n',
  julia: 'println("hello, friend!")\n',
  zig: 'const std = @import("std");\npub fn main() void {\n    std.debug.print("hello, friend!\\n", .{});\n}\n',
  ocaml: 'let () = print_endline "hello, friend!"\n',
  clojure: '(println "hello, friend!")\n',
  dart: 'void main() {\n  print("hello, friend!");\n}\n',
  fsharp: 'printfn "hello, friend!"\n',
  sql: '-- SQLite scratch\nSELECT "hello, friend!" AS greeting;\n',
};

const LEETCODE: Record<string, string> = {
  python: `# Two Sum — return indices of two numbers that sum to target.\nfrom typing import List\n\nclass Solution:\n    def two_sum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i\n        return []\n\nif __name__ == "__main__":\n    print(Solution().two_sum([2, 7, 11, 15], 9))\n`,
  javascript: `// Two Sum — return indices of two numbers that sum to target.\nfunction twoSum(nums, target) {\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const need = target - nums[i];\n    if (seen.has(need)) return [seen.get(need), i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n\nconsole.log(twoSum([2, 7, 11, 15], 9));\n`,
  typescript: `// Two Sum — return indices of two numbers that sum to target.\nfunction twoSum(nums: number[], target: number): number[] {\n  const seen = new Map<number, number>();\n  for (let i = 0; i < nums.length; i++) {\n    const need = target - nums[i];\n    if (seen.has(need)) return [seen.get(need)!, i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n\nconsole.log(twoSum([2, 7, 11, 15], 9));\n`,
  go: `package main\n\nimport "fmt"\n\nfunc twoSum(nums []int, target int) []int {\n    seen := map[int]int{}\n    for i, n := range nums {\n        if j, ok := seen[target-n]; ok {\n            return []int{j, i}\n        }\n        seen[n] = i\n    }\n    return nil\n}\n\nfunc main() {\n    fmt.Println(twoSum([]int{2, 7, 11, 15}, 9))\n}\n`,
  rust: `use std::collections::HashMap;\n\nfn two_sum(nums: Vec<i32>, target: i32) -> Vec<i32> {\n    let mut seen = HashMap::new();\n    for (i, &n) in nums.iter().enumerate() {\n        if let Some(&j) = seen.get(&(target - n)) {\n            return vec![j, i as i32];\n        }\n        seen.insert(n, i as i32);\n    }\n    vec![]\n}\n\nfn main() {\n    println!("{:?}", two_sum(vec![2, 7, 11, 15], 9));\n}\n`,
  java: `import java.util.*;\n\npublic class Main {\n    public static int[] twoSum(int[] nums, int target) {\n        Map<Integer, Integer> seen = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            Integer j = seen.get(target - nums[i]);\n            if (j != null) return new int[]{j, i};\n            seen.put(nums[i], i);\n        }\n        return new int[0];\n    }\n    public static void main(String[] args) {\n        System.out.println(Arrays.toString(twoSum(new int[]{2, 7, 11, 15}, 9)));\n    }\n}\n`,
  cpp: `#include <iostream>\n#include <unordered_map>\n#include <vector>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    unordered_map<int, int> seen;\n    for (int i = 0; i < (int)nums.size(); ++i) {\n        auto it = seen.find(target - nums[i]);\n        if (it != seen.end()) return {it->second, i};\n        seen[nums[i]] = i;\n    }\n    return {};\n}\n\nint main() {\n    vector<int> v = {2, 7, 11, 15};\n    auto r = twoSum(v, 9);\n    for (int x : r) cout << x << " ";\n    cout << endl;\n}\n`,
};

const PROBLEM_NOTE = '// Add a leetcode-style problem here. See https://leetcode.com/\n';

export function templateFor(languageId: string, kind: TemplateKind): string {
  const spec = resolveLanguage(languageId);
  const group = spec?.group ?? languageId;
  if (kind === 'leetcode') {
    return LEETCODE[group] ?? `${PROBLEM_NOTE}\n${HELLO[group] ?? ''}`;
  }
  return HELLO[group] ?? '';
}

export const TEMPLATE_KINDS: TemplateKind[] = ['hello', 'leetcode'];
