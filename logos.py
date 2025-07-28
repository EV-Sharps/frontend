

import os
import time

arr = []

for link in arr:
	team = link.split("/")[-1]
	os.system(f"curl '{link}' -o logos/nfl/{team}")
	time.sleep(0.2)