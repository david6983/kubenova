// +build ignore

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/tcp.h>
#include <linux/udp.h>
#include <linux/pkt_cls.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>

struct flow_key {
    __u32 src_ip;
    __u32 dst_ip;
    __u16 src_port;
    __u16 dst_port;
    __u8  proto;
    __u8  pad[3];
};

struct flow_val {
    __u64 bytes;
    __u64 packets;
    __u64 last_seen_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 65536);
    __type(key, struct flow_key);
    __type(value, struct flow_val);
} flows SEC(".maps");

static __always_inline int track(struct __sk_buff *skb) {
    void *data     = (void *)(long)skb->data;
    void *data_end = (void *)(long)skb->data_end;

    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end)
        return TC_ACT_OK;
    if (eth->h_proto != bpf_htons(ETH_P_IP))
        return TC_ACT_OK;

    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end)
        return TC_ACT_OK;

    struct flow_key key = {};
    key.src_ip = ip->saddr;
    key.dst_ip = ip->daddr;
    key.proto  = ip->protocol;

    void *transport = (void *)ip + (ip->ihl * 4);
    if (ip->protocol == IPPROTO_TCP) {
        struct tcphdr *tcp = transport;
        if ((void *)(tcp + 1) > data_end)
            return TC_ACT_OK;
        key.src_port = tcp->source;
        key.dst_port = tcp->dest;
    } else if (ip->protocol == IPPROTO_UDP) {
        struct udphdr *udp = transport;
        if ((void *)(udp + 1) > data_end)
            return TC_ACT_OK;
        key.src_port = udp->source;
        key.dst_port = udp->dest;
    }

    struct flow_val *val = bpf_map_lookup_elem(&flows, &key);
    if (!val) {
        struct flow_val new = {
            .bytes        = skb->len,
            .packets      = 1,
            .last_seen_ns = bpf_ktime_get_ns(),
        };
        bpf_map_update_elem(&flows, &key, &new, BPF_ANY);
    } else {
        __sync_fetch_and_add(&val->bytes,   skb->len);
        __sync_fetch_and_add(&val->packets, 1);
        val->last_seen_ns = bpf_ktime_get_ns();
    }

    return TC_ACT_OK;
}

SEC("tc/egress")
int tc_egress(struct __sk_buff *skb) { return track(skb); }

char LICENSE[] SEC("license") = "GPL";
