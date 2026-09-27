# Why the elevator algorithm takes linear time

For $n$ requests supplied in floor order, the
[continuation algorithm](../runs/elevator-presorted-2026-09-23-r02/argument.md)
takes $O(n)$ time in the unit-cost exact-arithmetic model. Release-time order is
unused.

Merging equal floors, choosing a maximum-release pivot, and pruning by suffix
maxima take linear scans. The resulting two chains contain $N\le n$ requests,
each contributing one continuation label. Monotonicity permits settling each
chain from outside inward and comparing only its next unsettled label with the
other chain's next label. There are at most $N$ settlements, $2N$ queries, and
$N$ insertions.

Each query minimizes $d+\max(W,z)$ over stored pairs $(d,z)$, where $d$ is twice
a request's distance from the pivot, $z$ its settled label, and $W$ the next
request's release time plus its distance from the pivot. In each query
structure, pairs arrive with $d$ decreasing and $z$ nondecreasing, while $W$ is
nondecreasing. Therefore

$$
\min_{(d,z)}\{d+\max(W,z)\}
=\min\left\{W+\min_{z\le W}d,\;\min_{z>W}(d+z)\right\}.
$$

Empty minima are $+\infty$. A forward pointer finds the last pair with $z\le W$,
which has the smallest qualifying $d$. A monotone minimum deque maintains the
second term: insertion removes dominated tail entries, and queries remove
front entries with $z\le W$. Each pair is passed by the pointer once, appended
once, and removed from the deque at most once. All queries and insertions
therefore cost $O(N)$ in total.

The final candidate values are evaluated by linear scans. Preprocessing,
label computation, and final evaluation thus take $O(n)$ time and $O(n)$ space,
independently of coordinate and release-time magnitudes.
