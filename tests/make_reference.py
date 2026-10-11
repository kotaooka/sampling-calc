# scipy で参照値を作り tests/reference.js に書き出す（どのフォルダからでも実行可: python tests/make_reference.py）
import json
from pathlib import Path
from scipy import stats
from scipy.stats import beta
cases = []
for (c,n,p) in [(0,2,0.065),(2,80,0.01),(5,80,0.025),(21,1250,0.015),(44,3,5.0/3),(1,2000,0.0001),(10,315,0.03),(0,500,0.001)]:
    if p<=1: cases.append(dict(kind='binom',c=c,n=n,p=p,v=float(stats.binom.cdf(c,n,p))))
for (c,N,D,n) in [(0,100,3,20),(2,500,10,80),(5,1000,40,80),(1,50,5,13),(0,10,1,8)]:
    cases.append(dict(kind='hyper',c=c,N=N,D=D,n=n,v=float(stats.hypergeom.cdf(c,N,D,n))))
for (c,lam) in [(0,0.13),(3,2.5),(44,30),(21,18.75)]:
    cases.append(dict(kind='pois',c=c,lam=lam,v=float(stats.poisson.cdf(c,lam))))
for (x,n,conf) in [(0,50,0.95),(0,300,0.95),(2,80,0.90),(5,125,0.95),(0,10,0.99)]:
    a=1-conf
    cases.append(dict(kind='cp',x=x,n=n,conf=conf,
      lower2=0.0 if x==0 else float(beta.ppf(a/2,x,n-x+1)),
      upper2=float(beta.ppf(1-a/2,x+1,n-x)),
      upper1=float(beta.ppf(conf,x+1,n-x))))
# 逆設計（二項）を総当たりで
def design(p1,al,p2,be):
    for c in range(0,61):
        for n in range(c+1,20000):
            if stats.binom.cdf(c,n,p2)<=be:
                ok = stats.binom.cdf(c,n,p1)>=1-al
                if ok: return (n,c)
                break
for (p1,al,p2,be) in [(0.01,0.05,0.05,0.10),(0.005,0.05,0.03,0.10),(0.02,0.05,0.08,0.10)]:
    n,c = design(p1,al,p2,be)
    cases.append(dict(kind='design',p1=p1,al=al,p2=p2,be=be,n=n,c=c))
# ロット判定（超幾何、厳密）
for (N,D,n,c) in [(1000,10,80,2),(500,25,50,0),(200,3,32,1),(10000,150,315,5)]:
    pmf=[float(stats.hypergeom.pmf(d,N,D,n)) for d in range(0,c+1)]
    pa=sum(pmf); esc=sum((D-d)*pmf[d] for d in range(c+1))
    cases.append(dict(kind='lot',N=N,D=D,n=n,c=c,pa=pa,find=float(1-stats.hypergeom.pmf(0,N,D,n)),esc=esc))
# 必要な検査数（不良率推定の逆算）を総当たりで
# 二項：binom.cdf(x, n, pu) <= 1 - conf となる最小の n
# 超幾何：D* = floor(pu*N) + 1 のとき hypergeom.cdf(x, N, D*, n) < 1 - conf となる最小の n（なければ None）
import math
def req_binom(pu, x, conf):
    a = 1 - conf
    # 正規近似の目安の手前から1つずつ増やす（総当たり）
    n = x + 1
    while stats.binom.cdf(x, n, pu) > a:
        n += 1
    return n
def req_hyper(pu, x, conf, N):
    a = 1 - conf
    D = math.floor(pu * N + 1e-9) + 1
    if D > N: return None
    for n in range(x + 1, N + 1):
        if stats.hypergeom.cdf(x, N, D, n) < a: return n
    return None
for (pu, x, conf) in [(0.01, 0, 0.95), (0.01, 0, 0.90), (0.05, 0, 0.95), (0.01, 1, 0.95), (0.01, 2, 0.90), (0.001, 0, 0.99), (0.10, 5, 0.95)]:
    cases.append(dict(kind='req', pu=pu, x=x, conf=conf, N=None, n=req_binom(pu, x, conf)))
for (pu, x, conf, N) in [(0.01, 0, 0.95, 1000), (0.01, 1, 0.95, 2000), (0.05, 0, 0.90, 200), (0.02, 0, 0.99, 100), (0.005, 3, 0.95, 50)]:
    cases.append(dict(kind='req', pu=pu, x=x, conf=conf, N=N, n=req_hyper(pu, x, conf, N)))
(Path(__file__).parent / 'reference.js').write_text(
    '// scipy で計算した参照値（make_reference.py で再生成）\nconst REFERENCE = ' + json.dumps(cases, indent=1) + ';\n'
    "if (typeof module !== 'undefined') module.exports = REFERENCE;\n",
    encoding='utf-8', newline='\n')
print(len(cases))
