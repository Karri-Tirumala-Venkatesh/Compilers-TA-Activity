import re
from typing import List, Dict, Set, Tuple

KEYWORDS = {"if", "goto", "return", "call", "param"}

class Instruction:
    def __init__(self, line: str, index: int):
        self.line = line.strip()
        self.index = index
        self.defs: Set[str] = set()
        self.uses: Set[str] = set()
        self.is_label = False
        self.label_name = None
        self.is_goto = False
        self.is_cond_goto = False
        self.target_label = None
        self.is_return = False
        self.is_move = False
        self.move_src = None
        self.move_dest = None
        
        self._parse()
        
    def _parse(self):
        # Check label
        if self.line.endswith(':'):
            self.is_label = True
            self.label_name = self.line[:-1].strip()
            return
            
        # Extract all potential variables/keywords
        tokens = re.findall(r'[a-zA-Z_]\w*', self.line)
        
        if self.line.startswith('goto '):
            self.is_goto = True
            self.target_label = tokens[1] if len(tokens) > 1 else None
            return
            
        if self.line.startswith('if '):
            self.is_cond_goto = True
            if 'goto ' in self.line:
                goto_idx = tokens.index('goto')
                if goto_idx + 1 < len(tokens):
                    self.target_label = tokens[goto_idx + 1]
            
            # uses are all variables between if and goto
            for t in tokens:
                if t not in KEYWORDS and t != self.target_label:
                    self.uses.add(t)
            return

        if self.line.startswith('return '):
            self.is_return = True
            for t in tokens:
                if t not in KEYWORDS:
                    self.uses.add(t)
            return

        # Basic assignment: a = b + c
        if '=' in self.line:
            parts = self.line.split('=', 1)
            lhs_tokens = re.findall(r'[a-zA-Z_]\w*', parts[0])
            rhs_tokens = re.findall(r'[a-zA-Z_]\w*', parts[1])
            
            for t in lhs_tokens:
                if t not in KEYWORDS:
                    self.defs.add(t)
            for t in rhs_tokens:
                if t not in KEYWORDS:
                    self.uses.add(t)
                    
            if len(self.defs) == 1 and len(rhs_tokens) == 1 and parts[1].strip() == rhs_tokens[0]:
                self.is_move = True
                self.move_dest = list(self.defs)[0]
                self.move_src = rhs_tokens[0]

class BasicBlock:
    def __init__(self, start_idx: int):
        self.start_idx = start_idx
        self.instructions: List[Instruction] = []
        self.successors: List['BasicBlock'] = []
        self.gen: Set[str] = set()
        self.kill: Set[str] = set()
        self.in_set: Set[str] = set()
        self.out_set: Set[str] = set()

def parse_tac_to_graph(tac_string: str) -> Dict:
    raw_lines = [L.strip() for L in tac_string.split('\n') if L.strip() and not L.startswith(('#', '//'))]
    instructions = [Instruction(line, i) for i, line in enumerate(raw_lines)]
    
    if not instructions:
        return {"variables": [], "interference": [], "move_preferences": []}
        
    # 1. Identify Leaders (Starts of Basic Blocks)
    leaders = {0}
    for i, inst in enumerate(instructions):
        if inst.is_label:
            leaders.add(i)
        if inst.is_goto or inst.is_cond_goto:
            if i + 1 < len(instructions):
                leaders.add(i + 1)
                
    leader_list = sorted(list(leaders))
    blocks: List[BasicBlock] = []
    block_map: Dict[int, BasicBlock] = {} # start_idx -> block
    label_to_block: Dict[str, BasicBlock] = {}
    
    # 2. Build Basic Blocks
    for i in range(len(leader_list)):
        start = leader_list[i]
        end = leader_list[i+1] if i + 1 < len(leader_list) else len(instructions)
        block = BasicBlock(start)
        block.instructions = instructions[start:end]
        blocks.append(block)
        block_map[start] = block
        
        if block.instructions[0].is_label:
            label_to_block[block.instructions[0].label_name] = block
            
    # 3. Add Edges (CFG)
    for i, block in enumerate(blocks):
        last_inst = block.instructions[-1]
        if last_inst.is_goto:
            if last_inst.target_label in label_to_block:
                block.successors.append(label_to_block[last_inst.target_label])
        elif last_inst.is_cond_goto:
            if last_inst.target_label in label_to_block:
                block.successors.append(label_to_block[last_inst.target_label])
            if i + 1 < len(blocks):
                block.successors.append(blocks[i+1])
        elif not last_inst.is_return:
            if i + 1 < len(blocks):
                block.successors.append(blocks[i+1])
                
    # 4. Generate GEN and KILL for each block
    all_variables = set()
    for block in blocks:
        for inst in block.instructions:
            for use in inst.uses:
                if use not in block.kill:
                    block.gen.add(use)
            for def_v in inst.defs:
                block.kill.add(def_v)
            all_variables.update(inst.defs)
            all_variables.update(inst.uses)
            
    # 5. Global Liveness Iteration
    changed = True
    while changed:
        changed = False
        for block in reversed(blocks):
            new_out = set()
            for succ in block.successors:
                new_out.update(succ.in_set)
            
            if new_out != block.out_set:
                block.out_set = new_out
                changed = True
            
            new_in = block.gen.union(block.out_set - block.kill)
            if new_in != block.in_set:
                block.in_set = new_in
                changed = True
                
    # 5b. Simple Loop Depth & Frequency Estimation
    usage_count = {var: 0 for var in all_variables}
    loop_vars = set()
    
    # Identify back-edges for a very rough loop depth estimation
    visited = set()
    stack = set()
    back_edges = set()
    
    def find_back_edges(b: BasicBlock):
        visited.add(b)
        stack.add(b)
        for s in b.successors:
            if s in stack:
                back_edges.add((b, s))
            elif s not in visited:
                find_back_edges(s)
        stack.remove(b)
    
    if blocks:
        find_back_edges(blocks[0])
        
    # Variables in blocks that are part of a loop (reachable from back-edge targets)
    in_loop_blocks = set()
    if back_edges:
        # Mark all blocks reachable from the target of a back-edge as "in loop"
        for _, target in back_edges:
            worklist = [target]
            while worklist:
                curr = worklist.pop()
                if curr not in in_loop_blocks:
                    in_loop_blocks.add(curr)
                    # For simplicity, don't follow successors indefinitely, 
                    # just mark immediate blocks in the cycle
                    for s in curr.successors:
                        if s not in in_loop_blocks: # This is a bit coarse
                            worklist.append(s)

    for block in blocks:
        is_loop = block in in_loop_blocks
        for inst in block.instructions:
            for v in inst.defs.union(inst.uses):
                usage_count[v] += 1
                if is_loop:
                    loop_vars.add(v)

    # 6. Instruction-level liveness and Interference
    interference = set()
    move_preferences = []
    
    for block in blocks:
        current_out = set(block.out_set)
        for inst in reversed(block.instructions):
            # Interference
            for d in inst.defs:
                for o in current_out:
                    if d != o:
                        # Optional: skip if move
                        if not (inst.is_move and inst.move_dest == d and inst.move_src == o):
                            edge = tuple(sorted([d, o]))
                            interference.add(edge)
            
            # Moves
            if inst.is_move:
                move_preferences.append({
                    "from": inst.move_dest,
                    "to": inst.move_src,
                    "gain": 2.5
                })
                
            # Update current_out for preceding instruction: in(i) = use(i) U (out(i) - def(i))
            current_out = inst.uses.union(current_out - inst.defs)
            
    # Format output payload
    vars_list = [
        {
            "name": var,
            "frequency": float(usage_count[var]),
            "loop_depth": 2.0 if var in loop_vars else 0.0,
            "move_gain": sum(m["gain"] for m in move_preferences if var in (m["from"], m["to"])),
            "bank_penalty": 0.0,
            "energy_penalty": 0.0
        }
        for var in all_variables
    ]
    
    return {
        "variables": vars_list,
        "interference": [list(e) for e in interference],
        "move_preferences": move_preferences
    }
