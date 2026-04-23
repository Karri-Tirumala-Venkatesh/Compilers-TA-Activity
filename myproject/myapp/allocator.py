from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple


DEFAULT_WEIGHTS = {
    "alpha": 3.0,
    "beta": 2.0,
    "gamma": 1.5,
    "delta": 1.0,
    "epsilon": 1.0,
    "lambda_spill": 3.0,
    "lambda_move": 1.5,
    "lambda_size": 1.0,
    "lambda_bank": 1.5,
    "lambda_energy": 1.5,
}


@dataclass
class Variable:
    name: str
    frequency: float = 1.0
    loop_depth: float = 0.0
    move_gain: float = 0.0
    bank_penalty: float = 0.0
    energy_penalty: float = 0.0
    allowed_registers: List[str] = field(default_factory=list)


class MOGRAAllocator:
    def __init__(self, payload: Dict):
        self.payload = payload
        self.weights = {**DEFAULT_WEIGHTS, **payload.get("weights", {})}
        self.registers = payload["registers"]
        self.register_names = [register["name"] for register in self.registers]
        self.register_info = {register["name"]: register for register in self.registers}
        self.variables = self._load_variables(payload["variables"])
        self.interference = self._load_interference(payload.get("interference", []))
        self.preference_pairs = self._load_preferences(payload.get("move_preferences", []))
        self.k = len(self.registers)

    def _load_variables(self, raw_variables: List[Dict]) -> Dict[str, Variable]:
        variables = {}
        for item in raw_variables:
            variable = Variable(
                name=item["name"],
                frequency=float(item.get("frequency", 1.0)),
                loop_depth=float(item.get("loop_depth", 0.0)),
                move_gain=float(item.get("move_gain", 0.0)),
                bank_penalty=float(item.get("bank_penalty", 0.0)),
                energy_penalty=float(item.get("energy_penalty", 0.0)),
                allowed_registers=item.get("allowed_registers", []),
            )
            variables[variable.name] = variable
        return variables

    def _load_interference(self, edges: List[List[str]]) -> Dict[str, Set[str]]:
        graph = {name: set() for name in self.variables}
        for left, right in edges:
            if left not in graph or right not in graph or left == right:
                continue
            graph[left].add(right)
            graph[right].add(left)
        return graph

    def _load_preferences(self, pairs: List[Dict]) -> Dict[Tuple[str, str], float]:
        prefs = {}
        for pair in pairs:
            left = pair["from"]
            right = pair["to"]
            gain = float(pair.get("gain", 1.0))
            prefs[(left, right)] = gain
            prefs[(right, left)] = gain
        return prefs

    def priority_score(self, variable: Variable) -> float:
        return (
            self.weights["alpha"] * variable.frequency
            + self.weights["beta"] * variable.loop_depth
            + self.weights["gamma"] * variable.move_gain
            - self.weights["delta"] * variable.bank_penalty
            - self.weights["epsilon"] * variable.energy_penalty
        )

    def spill_score(self, variable_name: str, active_graph: Dict[str, Set[str]]) -> float:
        variable = self.variables[variable_name]
        degree = len(active_graph[variable_name] & active_graph.keys())
        return self.priority_score(variable) / (degree + 1) if degree >= 0 else float('inf')

    def simplify(self):
        graph = {node: set(neighbors) for node, neighbors in self.interference.items()}
        active = set(graph)
        stack = []
        spill_candidates = set()

        while active:
            low_degree = [node for node in active if len(graph[node] & active) < self.k]
            if low_degree:
                chosen = min(low_degree, key=lambda node: (len(graph[node] & active), self.priority_score(self.variables[node]), node))
            else:
                chosen = min(active, key=lambda node: (self.spill_score(node, graph), len(graph[node] & active), node))
                spill_candidates.add(chosen)

            current_degree = len(graph[chosen] & active)
            stack.append((chosen, current_degree, chosen in spill_candidates))
            active.remove(chosen)

        return stack, spill_candidates

    def legal_registers(self, variable_name: str, assignment: Dict[str, str]) -> List[str]:
        variable = self.variables[variable_name]
        legal = variable.allowed_registers or self.register_names
        blocked = {assignment[neighbor] for neighbor in self.interference[variable_name] if neighbor in assignment}
        return [register for register in legal if register not in blocked]

    def move_cost(self, variable_name: str, register_name: str, assignment: Dict[str, str]) -> float:
        total_cost = 0.0
        for other_name, other_register in assignment.items():
            gain = self.preference_pairs.get((variable_name, other_name), 0.0)
            if gain == 0.0:
                continue
            if other_register == register_name:
                total_cost -= gain
            else:
                total_cost += gain
        return total_cost

    def register_cost(self, variable_name: str, register_name: str, assignment: Dict[str, str]) -> float:
        variable = self.variables[variable_name]
        register = self.register_info[register_name]
        spill_risk = 1.0 / (self.priority_score(variable) + 1e-6)
        size_cost = float(register.get("size_cost", 0.0))
        bank_cost = float(register.get("bank_penalty", 0.0)) + variable.bank_penalty
        energy_cost = float(register.get("energy_penalty", 0.0)) + variable.energy_penalty
        move_cost = self.move_cost(variable_name, register_name, assignment)

        return (
            self.weights["lambda_spill"] * spill_risk
            + self.weights["lambda_move"] * move_cost
            + self.weights["lambda_size"] * size_cost
            + self.weights["lambda_bank"] * bank_cost
            + self.weights["lambda_energy"] * energy_cost
        )

    def allocate(self):
        stack, provisional_spills = self.simplify()
        assignment: Dict[str, str] = {}
        spilled: List[str] = []
        decisions: List[Dict] = []

        while stack:
            variable_name, degree, marked_spill = stack.pop()
            legal = self.legal_registers(variable_name, assignment)
            if not legal:
                spilled.append(variable_name)
                decisions.append(
                    {
                        "variable": variable_name,
                        "action": "spill",
                        "priority": round(self.priority_score(self.variables[variable_name]), 4),
                        "degree_at_removal": degree,
                    }
                )
                continue

            ranked = sorted(
                ((register, self.register_cost(variable_name, register, assignment)) for register in legal),
                key=lambda item: (item[1], item[0]),
            )
            chosen_register, chosen_cost = ranked[0]
            assignment[variable_name] = chosen_register
            decisions.append(
                {
                    "variable": variable_name,
                    "action": "assign",
                    "register": chosen_register,
                    "cost": round(chosen_cost, 4),
                    "priority": round(self.priority_score(self.variables[variable_name]), 4),
                    "degree_at_removal": degree,
                }
            )

        return {
            "algorithm": "MOGRA",
            "register_count": self.k,
            "assignments": assignment,
            "spilled_variables": sorted(spilled),
            "provisional_spill_candidates": sorted(provisional_spills),
            "decisions": decisions,
        }


def simple_allocate(payload: Dict) -> Dict:
    """Classical greedy allocator (for comparison)."""
    registers = [r["name"] for r in payload["registers"]]
    variables = {v["name"]: v for v in payload["variables"]}
    interference = {}
    for v in variables:
        interference[v] = set()
    for a, b in payload.get("interference", []):
        if a in interference and b in interference and a != b:
            interference[a].add(b)
            interference[b].add(a)

    assignment = {}
    spilled = []

    for var_name in sorted(variables.keys()):
        blocked = {assignment[n] for n in interference[var_name] if n in assignment}
        legal = [r for r in registers if r not in blocked]
        if legal:
            assignment[var_name] = legal[0]
        else:
            spilled.append(var_name)

    return {
        "algorithm": "Classical",
        "register_count": len(registers),
        "assignments": assignment,
        "spilled_variables": spilled,
    }