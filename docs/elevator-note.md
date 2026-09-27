# The elevator problem in linear time

An elevator can serve all requests in the minimum possible time using a deterministic $O(n)$-time algorithm, provided the requests are supplied in floor order. The algorithm uses $O(n)$ space and does not need the supplied release-time order. These bounds count exact arithmetic, comparisons, and ordinary RAM operations at unit cost.

## The problem

There are $F\ge 1$ floors, numbered $0,\ldots,F-1$. The elevator starts at floor $s$ at time zero. At each integer time step it may move one floor in either direction or stay where it is. A request $(r_i,p_i)$ is served by any visit to floor $p_i$ at an integer time at least $r_i$. Service is instantaneous, including while passing through a floor. The final floor is unrestricted.

All $n\ge 1$ requests are known in advance. Release times are nonnegative integers, and repeated floors and release times are allowed. The input includes a permutation in nondecreasing floor order and another in nondecreasing release-time order. They may differ arbitrarily. The task is to compute the exact minimum completion time $T^*$ in worst-case $o(n\log n)$ time, uniformly over all coordinate and release-time magnitudes. Reading both supplied orders counts toward the bound. Producing them does not.

**Theorem.** For this input, $T^*$ can be computed deterministically in $O(n)$ time and $O(n)$ space in the unit-cost exact-arithmetic model. Floor order alone suffices.

## Reverse time and prune the requests

Fix an integer horizon $T$. Reversing a feasible schedule gives a walk with an unrestricted initial floor, a visit to each $p_i$ by deadline $T-r_i$, and arrival at $s$ by time $T$. Conversely, pad such a reverse walk with waiting at $s$ until time $T$ and reverse it. This gives an original schedule serving every request after its release. Waiting can be removed from a reverse walk because every constraint is an upper bound on a visit or arrival time.

Merge requests at each floor, keeping the largest release time there. Choose a requested floor $c$ whose release $M$ is maximum. Its reverse deadline $D=T-M$ is no later than any other deadline. Any feasible horizon has $T\ge M$.

On each side of $c$, write a floor's distance from $c$ as $x>0$ and its adjusted release as $r+x$. Delete an inner request at radius $x$ whenever an outer request at radius $x'>x$ has

$$
r'+x'\ge r+x.
$$

This deletion is valid even though the reverse starting floor is free. Let $u_c\le D$ be the first visit to $c$, and let $u'\le T-r'$ be a visit serving the outer request. If $u'<u_c$, the passage from the outer floor to $c$ crosses the inner floor by time $D\le T-r$. If $u'>u_c$, the passage from $c$ to the outer floor crosses the inner floor by time

$$
u'-(x'-x)\le T-r'-(x'-x)\le T-r.
$$

A scan from the outside inward retains exactly the strict suffix maxima of $r+x$, with equal values resolved in favor of the farther floor. Each deleted floor has a retained outer witness: take the farthest maximizer in its outward suffix. Thus simultaneous deletion is sound.

Write the retained left and right chains as

$$
\begin{aligned}
0<a_1<\cdots<a_H, &\qquad w_1>\cdots>w_H,\\
0<b_1<\cdots<b_G, &\qquad v_1>\cdots>v_G,
\end{aligned}
$$

where the left floor is $c-a_i$ and $w_i$ is its release plus $a_i$. On the right the floor is $c+b_j$ and $v_j$ is its release plus $b_j$. The pivot remains a separate request $(M,c)$. Merging, choosing $c$, and pruning take linear time in the supplied floor order.

## The form of a reverse route

Before its first visit to $c$, a reverse walk stays on one side. Let $x$ be the farthest retained radius it visits before reaching $c$, or let $x=0$ if it visits none. Replace this initial portion by the monotone inward sweep from that floor to $c$. Its duration is $x\le u_c\le D$. Every swept request is visited by time $D$, and every subsequent visit can be advanced by $u_c-x$. Thus the route may start at $c$ or with an inward sweep covering a prefix on one side. An inward sweep of radius $x$ requires $T\ge M+x$.

After reaching $c$, group the remaining retained floors in first-visit order into maximal runs on the same side. Call their extreme radii $e_1,\ldots,e_m$. The runs alternate sides, and their extreme radii increase on each side. If this portion starts at time $x$, every new radius $\rho$ in run $k$ is first visited no earlier than

$$
x+2\sum_{\ell<k}e_\ell+\rho.
$$

For the first run this follows from distance from $c$. For later runs, the walk must first reach the preceding extreme, then travel back through $c$ and out to $\rho$. Induction gives the displayed lower bound. The route that sweeps directly to each extreme and returns through $c$ attains all these bounds. After the final extreme it travels directly to $s$, attaining the corresponding lower bound on terminal arrival. Replacing the walk by this route therefore preserves feasibility, including when an initial prefix was already covered.

A nonfinal outward sweep and return will be called an excursion. A left excursion departing $c$ at time $q$, whose first new retained request has index $i$, meets all its new requests' deadlines exactly when

$$
q+w_i\le T.
$$

Indeed, each new radius $a_h$ is reached at $q+a_h$, and $w_h\le w_i$ for $h\ge i$. The right condition is $q+v_j\le T$. An excursion to radius $x$ adds $2x$ to elapsed time. Consecutive excursions on the same side can be merged, and excursions covering no new requests can be deleted.

If an initial inward sweep is followed by an excursion on the same side, remove the initial sweep and start at $c$. Later visits advance by $x$. The formerly swept requests are crossed outward by time $x\le D$, so their deadlines still hold. We may therefore assume that the first excursion after a nonempty inward sweep is on the opposite side.

## Continuation values

Suppose both chains are nonempty. Introduce vertices $A_1,\ldots,A_H$ and $B_1,\ldots,B_G$. A vertex $A_i$ represents a return to $c$ after covering at least the first $i$ left requests, ready for the next right excursion. Readiness means that its first uncovered right request can be reached by its deadline. Vertices $B_j$ have the symmetric interpretation. We do not store the covered prefix on the opposite side.

If all left requests are covered, the remaining right sweep and travel to $s$ have length $L_A$. Define the symmetric length $L_B$ by

$$
\begin{aligned}
L_A&=b_G+|c+b_G-s|,\\
L_B&=a_H+|c-a_H-s|.
\end{aligned}
$$

Make $A_H$ and $B_G$ absorbing terminals with these respective costs. For $i<H$ and every $j$, the edge $A_i\to B_j$ has transfer function

$$
f_{ij}(z)=2b_j+\max(w_{i+1},z).
$$

For $j<G$ and every $i$, the edge $B_j\to A_i$ has transfer function

$$
g_{ji}(z)=2a_i+\max(v_{j+1},z).
$$

The first term is the excursion's duration. The maximum imposes readiness for the following excursion and the remaining continuation bound. The current excursion's readiness is imposed by the incoming edge or by the initial choice of route.

The value of a path to a terminal is the composition of its transfer functions applied to the terminal cost. Let $\alpha_i$ and $\beta_j$ be the minimum path values from $A_i$ and $B_j$. Transfers are nondecreasing and strictly increase their arguments, so a cycle can be removed without increasing a path's value. Every nonterminal has an edge to the opposite terminal. Hence finite minimum path values exist, and they satisfy

$$
\begin{aligned}
\alpha_H&=L_A, &\beta_G&=L_B,\\
\alpha_i&=\min_{1\le j\le G}\{2b_j+\max(w_{i+1},\beta_j)\}
&& (i<H),\\
\beta_j&=\min_{1\le i\le H}\{2a_i+\max(v_{j+1},\alpha_i)\}
&& (j<G).
\end{aligned}
$$

The answer is the minimum over these four families:

$$
\begin{aligned}
\max\{M,w_1,2a_i+\max(v_1,\alpha_i)\},&\qquad 1\le i\le H,\\
\max\{M,v_1,2b_j+\max(w_1,\beta_j)\},&\qquad 1\le j\le G,\\
a_i+\max\{M,v_1,\alpha_i\},&\qquad 1\le i\le H,\\
b_j+\max\{M,w_1,\beta_j\},&\qquad 1\le j\le G.
\end{aligned}
$$

The first two families start at $c$ with an excursion on the left or right. The last two start with an inward sweep from the left or right. For example, a first left excursion takes $2a_i$ time. The constraints are $T\ge M$ at the pivot, $T\ge w_1$ on that excursion, and $T\ge 2a_i+\max(v_1,\alpha_i)$ for right readiness and continuation. An initial inward sweep instead takes $a_i$ time and requires $T\ge a_i+M$, giving the third family.

**Why graph paths give feasible routes.** At $A_i$, suppose elapsed time is $q$, the actual covered left prefix has length $\ell\ge i$, and the actual covered right prefix has length $k$. If $k<G$, readiness gives $q+v_{k+1}\le T$. The excursion on an edge $A_i\to B_j$ meets all newly visited right requests because their adjusted releases are at most $v_{k+1}$. It returns at $q'=q+2b_j$, and the transfer imposes $q'+w_{i+1}\le T$. If left requests remain, then $w_{\ell+1}\le w_{i+1}$, so readiness holds for the actual next left request. The new covered right prefix is at least $j$, establishing the symmetric invariant at $B_j$.

This argument also permits $j\le k$: that excursion merely revisits covered requests. Thus forgetting the opposite prefix introduces no infeasible candidate, even along graph paths with decreasing indices. At $A_H$, all left requests have been covered. Right readiness and the terminal cost $L_A$ permit a final right sweep and arrival at $s$. The other terminal is symmetric. Each of the four initial families establishes the required invariant, proving that every candidate gives a feasible horizon.

**Why every optimal route is represented.** Use the normalized route proved above. Represent an initial inward sweep, if present, and each nonfinal excursion by the corresponding vertex. Between consecutive vertices the route makes exactly the excursion represented by the edge. Its actual prefix indices make each readiness test necessary. Once one side is complete, every remaining excursion is on the other side and can be merged into the final sweep. Thus the first terminal reached is precisely the vertex before that final sweep. The initial choice is one of the four families. Replacing its continuation by the minimum graph label can only decrease its horizon. Together with feasibility of graph candidates, this proves the formula for $T^*$.

## Computing all labels in linear time

The graph has quadratically many possible edges, but its labels can be computed without listing them.

### Label order and two frontiers

The labels satisfy

$$
\alpha_1\ge\cdots\ge\alpha_H,\qquad
\beta_1\ge\cdots\ge\beta_G.
$$

For consecutive nonterminals this follows from the recurrence and the decreasing adjusted releases. To compare a nonterminal $A_i$ with its own terminal, a path ending at $A_H$ has value at least $L_A$. A path ending at $B_G$ has value at least $2b_G+L_B$, and the triangle inequality gives

$$
L_A\le 2b_G+L_B.
$$

Hence $\alpha_i\ge L_A=\alpha_H$. The other side is symmetric.

Use the following label-setting rule. Each unsettled terminal has its fixed cost. Each other unsettled vertex has a tentative value equal to the minimum transfer through a settled target, or $+\infty$ if there is none. Settle a vertex of minimum tentative value. Every finite tentative value is the value of an actual path, so it upper-bounds the true label.

To prove the rule, suppose the minimum tentative value exceeds some unsettled true label, and take an optimal path from that vertex. If the path reaches a settled vertex, consider the edge just before its first such vertex. The suffix value is at least that settled label. Monotonicity of the edge transfer, and the fact that all preceding transfers increase values, imply that the boundary edge supplies a tentative value no greater than the original path value. This contradicts minimality. If the path reaches no settled vertex, its terminal is unsettled and has fixed tentative value no greater than the path value, giving the same contradiction. Induction proves that each settled value is exact. Settlement values are nondecreasing.

Only two vertices need to be compared at each step: the next unsettled vertex in each of the orders

$$
A_H,A_{H-1},\ldots,A_1,
\qquad B_G,B_{G-1},\ldots,B_1.
$$

Call these the two frontiers. An unsettled terminal has the smallest tentative value on its side by label order. Otherwise, all unsettled vertices on one side minimize over the same settled opposite-side targets. Their tentative values are nondecreasing as their indices decrease, because the query values $w_{i+1}$ or $v_{j+1}$ increase. Thus each frontier has the minimum tentative value on its side, and choosing the smaller frontier implements the label-setting rule. Resolve ties in favor of the left frontier.

### Constant amortized time per query

Each frontier query has the form

$$
E(W)=\min_{(d,z)}\{d+\max(W,z)\},
$$

over stored pairs. For the left frontier, settling $B_j$ inserts $(d,z)=(2b_j,\beta_j)$, and the query is at $W=w_{i+1}$. For the right frontier, settling $A_i$ inserts $(2a_i,\alpha_i)$, and the query is at $W=v_{j+1}$.

Within either structure, $d$ strictly decreases in insertion order, settled labels $z$ are nondecreasing, and query arguments $W$ are nondecreasing. Split the minimum as

$$
E(W)=\min\left\{
W+\min_{z\le W}d,\;
\min_{z>W}(d+z)
\right\}.
$$

Empty minima have value $+\infty$. Keep all pairs in insertion order and a forward pointer to the last pair with $z\le W$. This pair has the smallest qualifying $d$, so it gives the first term. The pointer advances at most once per inserted pair, including when new pairs arrive after earlier queries.

For the second term, keep a deque of pairs with increasing values $d+z$. On insertion, remove tail entries whose $d+z$ is at least the new value, then append the new pair. This removal is sound: the newer pair has no larger value and no smaller $z$, so whenever the older pair qualifies for $z>W$, the newer one qualifies too. On a query, remove front entries with $z\le W$. The remaining front gives the second minimum. All pairs remain in the full insertion list, so deque removal cannot lose a contribution to the first term.

Each pair is appended once and removed from the deque at most once. All insertions and queries therefore take linear total time. A deque can be represented by an array with a front index and constant-time tail operations.

Start with both terminal frontiers and empty query structures. An unsettled terminal uses its fixed cost, a nonterminal queries its structure, and an exhausted chain has candidate $+\infty$. Settle the smaller candidate, insert its pair into the opposite structure, and advance its frontier inward. A finite candidate always exists: an unsettled terminal provides one, and once both terminals are settled every remaining nonterminal has an edge to a settled opposite terminal.

There are $H+G$ settlements and insertions, and at most $2(H+G)$ queries. Computing all labels takes $O(H+G)$ time and space.

## Empty sides and the complete algorithm

If both sides are empty, the reverse route starts at $c$ and goes directly to $s$, giving

$$
T^*=\max\{M,|c-s|\}.
$$

If exactly one side remains, let $x$ be its outermost radius, $q$ its outermost floor, and $W$ its largest adjusted release. The two possible route types are a sweep outward from $c$ followed by travel to $s$, or an inward sweep from $q$ to $c$ followed by travel to $s$. Their minimum gives

$$
T^*=\min\left\{
\max\{M,W,x+|q-s|\},\;
x+\max\{M,|c-s|\}
\right\}.
$$

The outward route's deadline constraints are $T\ge M,W$. The inward route's pivot constraint is $T\ge M+x$, which also covers every request on its initial sweep. Their remaining constraints are their respective terminal arrival times. A partial inward sweep followed by an outward sweep on the same side can be removed by the normalization argument, so these cases exhaust the possibilities.

The algorithm is now explicit:

1. Read the requests and supplied orders. Merge equal floors, choose a maximum-release pivot, and prune each side by a suffix-maximum scan.
2. If both chains are nonempty, compute their continuation labels with the two frontiers and query structures, then take the minimum of the four initial-route families.
3. If a chain is empty, use the appropriate formula above.

Preprocessing takes $O(n)$ time. The retained chains satisfy $H+G+1\le n$. Label computation and the final candidate scans take $O(H+G)$ time. Thus the total is $O(n)$ time and $O(n)$ space, including reading both supplied orders.

Every numerical operation is an exact addition, subtraction, comparison, absolute value, minimum, or maximum. Doubling is addition. There is no further sorting, numerical search, or iteration over elapsed time or empty floors. All values are integers, and the realizing walks stay between requested floors and $s$, so they use valid floors and reverse to admissible integer-time schedules. Only $T^*$ is output.

## Verification record

The underlying solution received a separate mathematical review. This note includes the review's explicit normalization argument for a reverse route with elapsed time and an already covered prefix. A saved implementation check compared the linear algorithm with the original quadratic endpoint-removal dynamic program on 64,775 instances and 85,812 maximum-release pivot choices, with no discrepancies.

The check comprised 44,775 exhaustive instances on one to five floors, with each floor absent or released at a time from zero to four, and 20,000 generated instances including repeated floors and scaled coordinates. These computations supplement the correctness and complexity proofs above.
