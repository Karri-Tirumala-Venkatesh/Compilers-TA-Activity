from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
import json
import time
import traceback
from .allocator import MOGRAAllocator, simple_allocate


def home(request):
    return render(request, 'myapp/home.html')


@csrf_exempt
@require_http_methods(["POST"])
def api_allocate(request):
    """Run MOGRA and Classical allocators on payload."""
    try:
        # Handle both JSON body and form data
        if request.content_type == 'application/json':
            payload = json.loads(request.body)
        else:
            payload = json.loads(request.POST.get('data', '{}'))
    except json.JSONDecodeError as e:
        return JsonResponse({"error": f"Invalid JSON: {str(e)}"}, status=400)
    except Exception as e:
        return JsonResponse({"error": f"Parse error: {str(e)}"}, status=400)

    # Validate payload
    if not payload.get("registers") or not payload.get("variables"):
        return JsonResponse({"error": "Missing registers or variables"}, status=400)

    try:
        # Classical allocator
        t0_classical = time.time()
        classical_result = simple_allocate(payload)
        t_classical = (time.time() - t0_classical) * 1000

        # MOGRA allocator
        t0_mogra = time.time()
        mogra = MOGRAAllocator(payload)
        mogra_result = mogra.allocate()
        t_mogra = (time.time() - t0_mogra) * 1000

        # Compute metrics
        def metrics(result):
            N = len(payload["variables"])
            assigned = len(result["assignments"])
            spills = len(result["spilled_variables"])
            spill_ratio = (spills / N * 100) if N > 0 else 0

            move_penalty = 0.0
            for p in payload.get("move_preferences", []):
                a_reg = result["assignments"].get(p["from"])
                b_reg = result["assignments"].get(p["to"])
                if a_reg and b_reg and a_reg != b_reg:
                    move_penalty += float(p.get("gain", 0))

            bank_cost = 0.0
            energy_cost = 0.0
            for var_name, reg_name in result["assignments"].items():
                var = next((v for v in payload["variables"] if v["name"] == var_name), {})
                reg = next((r for r in payload["registers"] if r["name"] == reg_name), {})
                bank_cost += float(var.get("bank_penalty", 0)) + float(reg.get("bank_penalty", 0))
                energy_cost += float(var.get("energy_penalty", 0)) + float(reg.get("energy_penalty", 0))

            return {
                "assigned": assigned,
                "spills": spills,
                "spill_ratio": round(spill_ratio, 1),
                "move_penalty": round(move_penalty, 2),
                "bank_cost": round(bank_cost, 2),
                "energy_cost": round(energy_cost, 2),
            }

        classical_result["metrics"] = metrics(classical_result)
        classical_result["runtimeMs"] = round(t_classical, 2)

        mogra_result["metrics"] = metrics(mogra_result)
        mogra_result["runtimeMs"] = round(t_mogra, 2)

        return JsonResponse({
            "success": True,
            "classical": classical_result,
            "mogra": mogra_result,
        })

    except Exception as e:
        return JsonResponse({"error": f"Allocation error: {str(e)}\n{traceback.format_exc()}"}, status=500)