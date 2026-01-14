
import json
import math
from pathlib import Path
from matplotlib.colors import TwoSlopeNorm, Normalize

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

def summarize_best_boxes(
	df: pd.DataFrame,
	top_n: int = 15,
	min_bets: int = 5,
	sort_by: str = "roi",   # "profit", "roi", "avg_profit"
):
	"""
	df must already include columns:
	  - ev (in percent units, e.g. 0..15)
	  - odds (american)
	  - profit (units, win payout or -1)
	  - ev_bin (pd.Interval)
	  - odds_bin (pd.Interval)
	"""
	g = (
		df.groupby(["ev_bin", "odds_bin"], observed=True)
		  .agg(
			  bets=("profit", "size"),
			  profit=("profit", "sum"),
			  avg_profit=("profit", "mean"),
		  )
		  .reset_index()
	)

	# ROI per bet is avg_profit (same thing). Keep both names for clarity.
	g["roi"] = g["avg_profit"]

	# Optional: add winrate + avg odds for context
	if "is_win" in df.columns:
		wr = df.groupby(["ev_bin", "odds_bin"], observed=True)["is_win"].mean().reset_index(name="win_rate")
		g = g.merge(wr, on=["ev_bin", "odds_bin"], how="left")

	if "odds" in df.columns:
		ao = df.groupby(["ev_bin", "odds_bin"], observed=True)["odds"].mean().reset_index(name="avg_odds")
		g = g.merge(ao, on=["ev_bin", "odds_bin"], how="left")

	# Filter out tiny-sample boxes
	g = g[g["bets"] >= min_bets].copy()

	# Add readable labels
	def fmt_ev(interval):
		return f"{interval.left:.0f}–{interval.right:.0f}%"

	def fmt_odds(interval):
		# These are numeric bins, not integer spans (see earlier discussion)
		return f"{interval.left:.0f}–{interval.right:.0f}"

	g["ev_range"] = g["ev_bin"].apply(fmt_ev)
	g["odds_range"] = g["odds_bin"].apply(fmt_odds)

	# Sort
	if sort_by not in {"profit", "roi", "avg_profit"}:
		raise ValueError("sort_by must be one of: profit, roi, avg_profit")

	g = g.sort_values(sort_by, ascending=False)

	cols = ["ev_range", "odds_range", "bets", "profit", "roi", "avg_profit"]
	if "win_rate" in g.columns: cols.append("win_rate")
	if "avg_odds" in g.columns: cols.append("avg_odds")

	return g[cols].head(top_n)

def format_top_boxes(
	best_df,
	n=4,
	include_bets=True,
	roi=False
):
	lines = []

	for _, r in best_df.head(n).iterrows():
		odds = r["odds_range"]
		ev = r["ev_range"]

		# ROI is avg profit per bet → convert to %
		roi_pct = int(round(r["roi"] * 100))

		if roi:
			line = f"+{odds} ({ev.replace('-0', '0')} EV): {roi_pct}"
		else:
			line = f"+{odds} ({ev.replace('-0', '0')} EV): {round(r['profit'], 1)}u"

		if include_bets:
			line += f" ({int(r['bets'])} bets)"

		lines.append(line)

	return "\n".join(lines)

def american_win_profit(odds: float) -> float:
	"""Profit on a 1u stake for a winning bet at American odds."""
	if odds == 0:
		return 0.0
	if odds > 0:
		return odds / 100.0
	return 100.0 / abs(odds)


def load_bets(data) -> pd.DataFrame:
	df = pd.DataFrame(data)

	if "hit" in df.columns:
		df["is_win"] = df["hit"] == True
	else:
		raise ValueError("Expected a 'hit' (true/false)")

	return df


def normalize_ev_to_percent(df: pd.DataFrame) -> pd.DataFrame:
	"""
	Your earlier charts use EV in percent units (0–15).
	If input looks like decimals (0–0.15), convert to percent.
	If input already looks like percent (0–15), leave it.
	"""
	ev_max = float(df["ev"].max())
	# Heuristic: if max EV <= 1.5, treat as decimal (e.g. 0.04 = 4%)
	if ev_max <= 1.5:
		df["ev"] = df["ev"] * 100.0
	return df


def make_profit_heatmap(
	df: pd.DataFrame,
	out_png: str = "profit_heatmap.png",
	out_csv: str | None = None,
	ev_range=(0, 15),
	ev_step=1,
	odds_range=(100, 1200),
	odds_step=100,
	book="fd",
	sport="nhl",
	dev="hr",
	roi=False,
	silent=False
):
	if sport in ["nba"]:
		odds_range = (-200, 1000)
	if sport == "nhl" and dev == "hr":
		ev_range = (0, 25)
		odds_range = (0, 1400)
	df = df.copy()
	df = normalize_ev_to_percent(df)

	# Filter to requested display range
	df = df[(df["ev"] >= ev_range[0]) & (df["ev"] <= ev_range[1])]
	df = df[(df["odds"] >= odds_range[0]) & (df["odds"] <= odds_range[1])]

	# Profit in units (1u stake)
	df["profit"] = np.where(
		df["is_win"],
		df["odds"].astype(float).apply(american_win_profit),
		-1.0,
	)

	# Bins
	ev_bins = np.arange(ev_range[0], ev_range[1] + ev_step, ev_step)  # 0..15 step 1
	odds_bins = np.arange(odds_range[0], odds_range[1] + odds_step, odds_step)  # 0..1200 step 100

	df["ev_bin"] = pd.cut(df["ev"], bins=ev_bins, include_lowest=True, right=True)
	df["odds_bin"] = pd.cut(df["odds"], bins=odds_bins, include_lowest=True, right=True)

	if not silent:
		best = summarize_best_boxes(df, top_n=20, min_bets=5, sort_by="roi" if roi else "profit")
		#print(sport, dev, best.to_string(index=False))
		print("\n", sport, book, "vs", dev, "\n",format_top_boxes(best, n=4, roi=roi))

	counts = 0
	if roi:
		# roi
		heatmap = (
			df.groupby(["odds_bin", "ev_bin"], observed=True)["profit"]
			  .mean()
			  .unstack()
		)
		counts = (
			df.groupby(["odds_bin", "ev_bin"], observed=True)["profit"]
			  .size()
			  .unstack()
			  .fillna(0)
		)
	else:
		# Aggregate total profit by (odds_bin, ev_bin)
		heatmap = (
			df.groupby(["odds_bin", "ev_bin"], observed=True)["profit"]
			  .sum()
			  .unstack()
			  .fillna(0.0)
		)

	wins = (
		df[df["is_win"]]
		.groupby(["odds_bin", "ev_bin"], observed=True)
		.size()
		.unstack()
	)

	wins = wins.reindex(index=counts.index, columns=counts.columns).fillna(0)

	losses = counts - wins
		

	min_bets = 1
	heatmap = heatmap.where(counts >= min_bets)

	# Optional CSV export
	if out_csv:
		heatmap.to_csv(out_csv)

	# Plot
	fig, ax = plt.subplots(figsize=(14, 10))
	h, w = heatmap.values.shape

	if heatmap.values.size == 0 or heatmap.shape[0] == 0 or heatmap.shape[1] == 0:
		return

	if roi:
		arr = heatmap.to_numpy()
		finite = arr[np.isfinite(arr)]
		if finite.size == 0:
			return
		#vmin = max(-0.5, finite.min())
		#vmax = min(0.5, finite.max())
		vmin = max(-1, finite.min())
		vmax = min(1, finite.max())
	else:
		vmin = min(-10, np.nanmin(heatmap.values))
		vmax = max(10, np.nanmax(heatmap.values))

	try:
		norm = TwoSlopeNorm(vmin=vmin, vcenter=0, vmax=vmax)
	except:
		return

	im = ax.imshow(
		heatmap.values,
		aspect="auto",
		cmap="RdBu",
		norm=norm
	)

	cbar = plt.colorbar(
		im,
		ax=ax,
		orientation="horizontal",
		pad=0.08,      # space between plot and colorbar
		fraction=0.05  # thickness of colorbar
	)
	if roi:
		cbar.set_label("ROI (avg units per bet)")
	else:
		cbar.set_label("Total Profit (units)")

	# X labels: EV bins (0–1%, 1–2%, ...)
	ax.set_xticks(range(len(heatmap.columns)))
	ax.set_xticklabels(
		[f"{int(b.left)}–{int(b.right)}%" for b in heatmap.columns],
		rotation=45,
		ha="right",
	)

	# Y labels: odds bins (0–100, 100–200, ...)
	ax.set_yticks(range(len(heatmap.index)))
	ax.set_yticklabels(
		[f"{int(b.left)}–{int(b.right)}" for b in heatmap.index]
	)

	ax.set_xlabel("EV (%)")
	ax.set_ylabel("American Odds")
	ax.set_title(f"{sport.upper()} {prop.upper()} {'ROI' if roi else 'Total Profit'} Heatmap (bet on {book.upper()}, devig vs {dev.upper()})")

	for i in range(h):
		for j in range(w):
			if (
				counts is None
				or pd.isna(counts.iloc[i, j])
				or counts.iloc[i, j] < min_bets
			):
				continue

			try:
				w_ = int(wins.iloc[i, j]) if not pd.isna(wins.iloc[i, j]) else 0
				l_ = int(losses.iloc[i, j]) if not pd.isna(losses.iloc[i, j]) else 0

				ax.text(
					j, i,
					f"{w_}W {l_}L",
					ha="center",
					va="center",
					fontsize=8,
					color="black",
					bbox=dict(
						boxstyle="round,pad=0.2",
						facecolor="white",
						alpha=0.65,
						linewidth=0
					)
				)
			except:
				pass

	plt.tight_layout()
	fig.savefig(out_png, dpi=200)
	plt.close(fig)

	return True


if __name__ == "__main__":
	import argparse

	parser = argparse.ArgumentParser()
	parser.add_argument("--roi", "-r", action="store_true")
	parser.add_argument("--silent", "-s", action="store_true")
	args = parser.parse_args()


	if False:
		with open("static/analysis/xy/nhl.json") as fh:
			xy = json.load(fh)

		arr = xy["dk"]["pn+espn+hr"]
		for row in arr:
			print(row)
		exit()

	index = {}
	#for sport in ["nfl"]:
	for sport in ["nhl", "nba", "nfl"]:
		prop = "atgs" if sport == "nhl" else "attd"
		if sport == "nba":
			prop = "reb"
		with open(f"static/analysis/xy/{sport}.json") as fh:
			xy = json.load(fh)
		for book, devs in xy.items():
			for dev, j in devs.items():
				df = load_bets(j)
				heat = make_profit_heatmap(df, book=book, sport=sport, dev=dev, out_png=f"static/analysis/heatmaps/{sport}_{prop}/{book}_{dev}.png", roi=args.roi, silent=args.silent)
				#print(f"{sport}_{prop}/{book}_{dev}.png")
				#exit()
				if heat:
					index[f"{sport}_{prop}/{book}_{dev}.png"] = 1

	with open(f"static/analysis/heatmaps/index.json", "w") as fh:
		json.dump(index, fh, indent=2)
