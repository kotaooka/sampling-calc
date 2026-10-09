# scipy で参照値を作り tests/reference.js に書き出す（tests フォルダで実行: python make_reference.py）
import json
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
open('reference.js','w').write('// scipy で計算した参照値（make_reference.py で再生成）\nconst REFERENCE = ' + json.dumps(cases, indent=1) + ';\n')
print(len(cases))
