# fetch_all_candles.py
import requests
import time
import json

API_BASE = "https://final-ocai.onrender.com"

def get_all_companies():
    response = requests.get(f"{API_BASE}/api/companies/all")
    return response.json()["data"]

def get_candles(symbol, period="1y"):
    try:
        response = requests.get(f"{API_BASE}/api/candles/{symbol}?period={period}")
        return response.json()
    except:
        return None

def fetch_all_candles(period="1y"):
    print("Fetching all companies...")
    companies = get_all_companies()
    print(f"Found {len(companies)} companies")
    
    results = []
    for i, company in enumerate(companies):
        print(f"[{i+1}/{len(companies)}] Fetching {company['symbol']}...")
        candle_data = get_candles(company['symbol'], period)
        
        if candle_data and candle_data.get("success"):
            results.append({
                "symbol": company['symbol'],
                "name": company['name'],
                "count": candle_data["count"],
                "data": candle_data["data"]
            })
            print(f"  ✅ {candle_data['count']} candles")
        else:
            print(f"  ❌ No data")
        
        time.sleep(0.5)  # Rate limiting
    
    # Save to file
    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "period": period,
        "total_companies": len(companies),
        "data": results
    }
    
    with open("all_candles.json", "w") as f:
        json.dump(output, f, indent=2)
    
    print(f"\n✅ Saved to all_candles.json")

if __name__ == "__main__":
    period = input("Enter period (1m/3m/6m/1y/3y/5y): ") or "1y"
    fetch_all_candles(period)